import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { createReportingEngine, createReportingServices } from '../../src/runtime/reporting/engine'
import { reportWorkspaceKey } from '../../src/core/reporting/sources/local'
import { compareReports } from '../../src/core/reporting/diff'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { REPORT_AS_OF } from './helpers/reporting/runtime'
import { reportDocument } from './helpers/reporting/snapshot'
import { REPORT_THEME } from './reportRenderFixtures'
import { referenceModel as nodeReference } from '../../src/runtime/reference.node.generated'
import { referenceModel } from '../../src/shared/reference/reference.generated'

// Report storage's own-process identity probe and Git metadata are bounded OS
// commands; on Windows and macOS the probe spawns (Linux reads /proc). Their
// governed admission is proved by spawnGovernance; here they run directly.
vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureCommand(await original())
})

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function diffServices() {
  const root = await mkdtemp(path.join(tmpdir(), 'report-engine-diff-'))
  roots.push(root)
  return createReportingServices({
    workspaceRoot: root,
    storageRoot: path.join(root, 'data'),
    l10n: { table: EN, locale: 'en' },
    generatorVersion: '0.0.0-test',
    keepHistory: false,
    enabledAgents: [],
  })
}
describe('the bound report engine', () => {
  it('generates, scrubs, renders and retrieves the same report through the real local pipeline', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'report-engine-'))
    roots.push(root)
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { quality: 'npm test' } }),
    )
    await writeFile(
      path.join(root, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A local change.\n',
    )
    const workspaceKey = reportWorkspaceKey(root, process.platform)
    const engine = createReportingEngine({
      workspaceRoot: root,
      workspaceKey,
      storageRoot: path.join(root, 'data'),
      l10n: { table: EN, locale: 'en' },
      generatorVersion: '0.0.0-test',
      keepHistory: true,
      enabledAgents: [],
    })
    const options = {
      kind: 'quality' as const,
      asOf: REPORT_AS_OF,
      scope: '',
      full: false,
      network: false,
      failOn: [],
    }
    const result = await engine.reports.run({ workspaceKey, options })
    expect(result.status).toBe('generated')
    if (result.status !== 'generated') throw new Error(JSON.stringify(result))
    expect(result.document.sources.find(({ id }) => id === 'checkRuns')?.status).toBe('unavailable')
    expect(result.document.sections.find(({ id }) => id === 'gates')?.rows.length).toBe(1)
    for (const format of ['text', 'md', 'html', 'json'] as const) {
      const rendered = engine.render[format](result.document, 'en', REPORT_THEME)
      expect(rendered).toContain(result.document.header.contentHash)
      expect(rendered).not.toContain(root)
    }
    const listed = await engine.reports.history({ workspaceKey, kind: 'quality' })
    if (listed.status !== 'listed' || listed.entries[0] === undefined)
      throw new Error('History unavailable')
    const saved = await engine.reports.get({
      workspaceKey,
      kind: 'quality',
      id: listed.entries[0].id,
    })
    expect(saved).toEqual({ status: 'retrieved', document: result.document })
    const refused = await engine.reports.history({ workspaceKey: 'foreign', kind: 'quality' })
    expect(refused.status).toBe('failed')
  })
  it('uses the exact same generated reference model in the compressed Node entry', () => {
    expect(nodeReference()).toEqual(referenceModel())
  })
  it('renders a changed comparison in every format from verified reports', async () => {
    const services = await diffServices()
    const before = finalizeReport(reportDocument())
    const changed = reportDocument()
    changed.sections[0]!.rows[0]!.cells['state'] = { type: 'label', value: 'merged' }
    const after = finalizeReport(changed)
    const diff = compareReports(before, after)
    const renderDiff = services.renderDiff
    if (renderDiff === undefined) throw new Error('Expected a diff renderer')
    for (const format of ['md', 'html', 'json', 'text'] as const) {
      const rendered = renderDiff(diff, after, format, 'en', REPORT_THEME)
      expect(rendered).toContain('M12')
      expect(rendered).not.toContain('Invalid report document')
    }
    expect(renderDiff(diff, after, 'json', 'en', REPORT_THEME)).toContain('"id": "diff"')
  })
  it('renders identical reports in HTML and JSON instead of failing the comparison', async () => {
    const services = await diffServices()
    const document = finalizeReport(reportDocument())
    const diff = compareReports(document, document)
    const renderDiff = services.renderDiff
    if (renderDiff === undefined) throw new Error('Expected a diff renderer')
    expect(renderDiff(diff, document, 'md', 'en', REPORT_THEME)).toContain('No change since')
    expect(renderDiff(diff, document, 'text', 'en', REPORT_THEME)).toContain('No change since')
    for (const format of ['html', 'json'] as const) {
      const rendered = renderDiff(diff, document, format, 'en', REPORT_THEME)
      expect(rendered).not.toContain('Invalid report document')
    }
    expect(renderDiff(diff, document, 'html', 'en', REPORT_THEME)).toContain('Difference')
    expect(renderDiff(diff, document, 'json', 'en', REPORT_THEME)).toContain('"id": "diff"')
  })
})
