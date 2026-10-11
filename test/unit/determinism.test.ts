import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { REPORT_KINDS, REPORT_FORMATS } from '../../src/shared/constants'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { RENDERERS, REPORT_THEME, renderFixture } from './reportRenderFixtures'
import { removeFolder } from './helpers/temporaryFolders'
import { buildFixtureRepository } from './helpers/reporting/repository'

const ROOT = path.resolve(import.meta.dirname, '../..')
const state: { folder: string; child: string; inputs: string[]; subjects: string[] } = {
  folder: '',
  child: '',
  inputs: [],
  subjects: [],
}

beforeAll(async () => {
  await mkdir(path.join(ROOT, 'temp'), { recursive: true })
  state.folder = await mkdtemp(path.join(ROOT, 'temp/report-determinism-'))
  state.child = path.join(state.folder, 'render.cjs')
  const repository = await buildFixtureRepository(path.join(state.folder, 'repository'))
  state.subjects = repository.git(['log', '--format=%s', '--reverse']).split(/\r?\n/)
  const result = await esbuild.build({
    stdin: {
      contents: `
        const {readFileSync} = require('node:fs');
        const {createReportRenderers} = require('./src/core/reporting/render');
        const {EN} = require('./src/shared/l10n/en');
        const input = JSON.parse(readFileSync(0, 'utf8'));
        const renderers = createReportRenderers({textForLocale: () => EN});
        process.stdout.write(JSON.stringify(input.documents.map(document =>
          Object.values(renderers).map(render => render(document, input.locale, input.theme)))));
      `,
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: state.child,
    metafile: true,
    logLevel: 'silent',
  })
  state.inputs = Object.keys(result.metafile.inputs).map((file) => file.replaceAll('\\', '/'))
})
afterAll(async () => {
  await removeFolder(state.folder)
})

describe('all-kind, all-format report determinism', () => {
  it('uses the real fixed-date fixture repository subjects in the normalized golden facts', () => {
    const document = renderFixture('changes')
    expect(state.subjects).toEqual(['M12: fixture contracts', 'M110a0: fixture runtime'])
    for (const [index, subject] of state.subjects.entries()) {
      const value = document.sections[0]!.rows[index]!.cells['name']!
      expect(value.type).toBe('text')
      if (value.type === 'text') expect(value.value).toContain(subject)
    }
  })
  it('renders twice in process without clock or randomness reads', () => {
    const documents = REPORT_KINDS.map((kind) => renderFixture(kind))
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Ambient clock read')
    })
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Ambient random read')
    })
    try {
      for (const document of documents)
        for (const format of REPORT_FORMATS) {
          expect(RENDERERS[format](document, 'en', REPORT_THEME)).toBe(
            RENDERERS[format](document, 'en', REPORT_THEME),
          )
        }
    } finally {
      clock.mockRestore()
      random.mockRestore()
    }
  })
  it('byte-compares two child processes with different TZ and LANG against the parent', () => {
    const documents = REPORT_KINDS.map((kind) => renderFixture(kind))
    const input = JSON.stringify({ documents, locale: 'en', theme: REPORT_THEME })
    const run = (TZ: string, LANG: string) =>
      execFileSync(process.execPath, [state.child], {
        input,
        env: { SystemRoot: process.env['SystemRoot'], PATH: process.env['PATH'], TZ, LANG },
        windowsHide: true,
      })
    const a = run('America/Los_Angeles', 'de_DE.UTF-8')
    const b = run('Asia/Tokyo', 'tr_TR.UTF-8')
    const parent = Buffer.from(
      JSON.stringify(
        documents.map((document) =>
          Object.values(RENDERERS).map((render) => render(document, 'en', REPORT_THEME)),
        ),
      ),
    )
    expect(a.equals(b)).toBe(true)
    expect(a.equals(parent)).toBe(true)
  })
  it('ignores fact-row, source, cell-field and source-reference insertion order', () => {
    for (const kind of REPORT_KINDS) {
      const document = renderFixture(kind)
      const reordered = structuredClone(document)
      reordered.needsYou.rows.reverse()
      reordered.sources.reverse()
      for (const section of reordered.sections) {
        section.rows.reverse()
        for (const row of section.rows) {
          row.cells = Object.fromEntries(Object.entries(row.cells).toReversed())
          row.sourceIds.reverse()
        }
      }
      const clean = finalizeReport(reordered)
      expect(clean.header.contentHash).toBe(document.header.contentHash)
      for (const format of REPORT_FORMATS)
        expect(RENDERERS[format](clean, 'en', REPORT_THEME)).toBe(
          RENDERERS[format](document, 'en', REPORT_THEME),
        )
    }
  })
  it('the complete renderer import graph contains no backend, paid gate or host module', () => {
    expect(
      state.inputs.some((file) => /src\/(?:core\/backends|core\/paid|host)\//.test(file)),
    ).toBe(false)
    expect(state.inputs.some((file) => file.endsWith('sessionTransfer.ts'))).toBe(true)
  })
})
