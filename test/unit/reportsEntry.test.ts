import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createRuntimeReports,
  type RuntimeReportsInput,
} from '../../src/runtime/reporting/reportsEntry'
import { reportsLoader } from '../../src/runtime/reporting/reportsLoader'
import { EN } from '../../src/shared/l10n/en'
import { reportsHarness } from './helpers/reporting/runtime'
import { UI_TEXT } from '../../src/shared/constants'
import { RENDERERS, REPORT_THEME } from './reportRenderFixtures'
import { createRuntimeReports as createFixtureReports } from '../e2e/reportsEntry'

function entry(overrides: Partial<RuntimeReportsInput> = {}) {
  const h = reportsHarness()
  const readTable = vi.fn(async (locale: string): Promise<unknown> => {
    const text = await readFile(
      path.resolve(import.meta.dirname, '../../l10n', `ui.${locale}.json`),
      'utf8',
    )
    return JSON.parse(text)
  })
  const servicesFor = vi.fn<NonNullable<RuntimeReportsInput['servicesFor']>>(() =>
    Promise.resolve({ services: h.deps.services, keepHistory: false }),
  )
  const input: RuntimeReportsInput = {
    cwd: '/reports/workspace',
    locale: 'en',
    table: EN,
    roots: ['/home/fixture'],
    now: h.now,
    servicesFor,
    readTable,
    readSaved: (_cwd, file) => h.readSaved(file),
    resolveSaved: (_cwd, file) => Promise.resolve(file),
    writeOut: (_cwd, file, text) => h.writeOut(file, text),
    stdout: h.stdout,
    stderr: h.stderr,
    ...overrides,
  }
  return { ...h, input, reports: createRuntimeReports(input), readTable, servicesFor }
}

describe('lazy runtime report entry', () => {
  it('uses the same fixture collector binding as the CLI for the typed not-found result', async () => {
    const h = entry()
    const reports = createFixtureReports(h.input)
    expect(await reports.run(['milestone', 'M999'])).toBe(3)
    expect(h.stderr).toHaveBeenCalledWith('Not found: M999. Nearest matches: M113')
    expect(h.readSaved).toHaveBeenCalledWith('fixture.json')
    expect(h.generate).not.toHaveBeenCalled()
  })
  it('loads on demand, checks the bundle export, retries a bad export, and caches the real factory', () => {
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const loadBundle = vi
      .fn<() => unknown>()
      .mockReturnValueOnce({})
      .mockReturnValue({ createRuntimeReports })
    const load = reportsLoader({ bundlePath: '/fake/reporting.js', log, loadBundle })
    expect(loadBundle).not.toHaveBeenCalled()
    expect(() => load()).toThrow(UI_TEXT.reportUi.generationFailed)
    expect(load().createRuntimeReports).toBe(createRuntimeReports)
    expect(load().createRuntimeReports).toBe(createRuntimeReports)
    expect(loadBundle).toHaveBeenCalledTimes(2)
  })

  it('re-renders without loading sources or history, and validates a real translated table', async () => {
    const h = entry()
    expect(await h.reports.run(['--from', 'saved.json', '--format', 'json'])).toBe(0)
    expect(h.stdout.mock.calls[0]?.[0]).toBe(RENDERERS.json(h.document, 'en', REPORT_THEME))
    expect(h.servicesFor).not.toHaveBeenCalled()
    expect(await h.reports.run(['--from', 'saved.json', '--lang', 'de'])).toBe(0)
    expect(h.readTable).toHaveBeenCalledWith('de')
    expect(h.stdout.mock.lastCall?.[0]).toContain('Projekt')
    expect(h.stdout.mock.lastCall?.[0]).toContain('Sprache de')
  })

  it('refuses lexical and resolved credential paths with Windows separators before reading bytes', async () => {
    for (const file of [
      'auth.json',
      String.raw`C:\Users\Owner\.codex\auth.json`,
      '/home/owner/.env.production',
      'credentials.json',
      '/home/owner/id_ed25519',
    ]) {
      const h = entry()
      expect(await h.reports.run(['--from', file])).toBe(1)
      expect(h.readSaved).not.toHaveBeenCalled()
    }
    const resolved = entry({
      resolveSaved: () => Promise.resolve(String.raw`C:\Users\Owner\.claude\.credentials.json`),
    })
    expect(await resolved.reports.run(['--from', 'apparently-safe.json'])).toBe(1)
    expect(resolved.readSaved).not.toHaveBeenCalled()
  })

  it('returns explicit failure for missing services, invalid translations and throwing bindings', async () => {
    const missing = entry({ servicesFor: undefined })
    expect(await missing.reports.run(['project'])).toBe(1)
    expect(missing.generate).not.toHaveBeenCalled()
    const broken = entry({ readTable: () => Promise.resolve({ reportUi: {} }) })
    expect(await broken.reports.run(['project', '--lang', 'de'])).toBe(1)
    expect(broken.servicesFor).not.toHaveBeenCalled()
    const throwing = entry({ servicesFor: () => Promise.reject(new Error('CANARY-private')) })
    expect(await throwing.reports.run(['project'])).toBe(1)
    expect(throwing.stderr).toHaveBeenCalledWith(UI_TEXT.reportUi.generationFailed)
  })

  it('uses the requested table for diagnostics without changing global language state', async () => {
    const h = entry({ servicesFor: undefined })
    expect(await h.reports.run(['project', '--lang', 'de'])).toBe(1)
    expect(h.stderr.mock.lastCall?.[0]).not.toBe(UI_TEXT.reportUi.generationFailed)
    expect(h.stderr.mock.lastCall?.[0]).toContain('Bericht')
    expect(UI_TEXT.reportUi.generationFailed).toBe(EN.reportUi.generationFailed)
  })

  it('offers the ACP picker, Markdown/text reports, history, help and usage without a model', async () => {
    const h = entry()
    const context = {
      cwd: '/reports/other-workspace',
      sessionId: 'current-session',
      format: 'md' as const,
      signal: new AbortController().signal,
    }
    expect(await h.reports.acp.execute('', context)).toMatchObject({
      code: 0,
      text: expect.stringContaining('/report project'),
    })
    expect(await h.reports.acp.execute('project', context)).toMatchObject({
      code: 0,
      text: expect.stringContaining('# Project'),
    })
    expect(
      await h.reports.acp.execute('session --save', { ...context, format: 'text' }),
    ).toMatchObject({ code: 0, text: expect.stringContaining('Session') })
    expect(h.generate.mock.lastCall?.[0].sessionId).toBe('current-session')
    expect(h.servicesFor.mock.lastCall).toEqual([context.cwd, context.sessionId])
    expect(h.history.save).toHaveBeenCalledTimes(1)
    expect(await h.reports.acp.execute('history project', context)).toMatchObject({
      code: 0,
      text: expect.stringContaining('saved'),
    })
    expect(await h.reports.acp.execute('--help', context)).toMatchObject({ code: 0 })
    for (const args of [
      'project --format html',
      'project --out file.md',
      'project --bogus',
      `project --out 'unfinished`,
    ])
      expect(await h.reports.acp.execute(args, context)).toMatchObject({ code: 2 })
    expect(h.writeOut).not.toHaveBeenCalled()
  })

  it('honors explicit ACP text and Markdown formats and refuses unsupported transport formats', async () => {
    const context = {
      cwd: '/reports/workspace',
      sessionId: 'format-session',
      format: 'md' as const,
      signal: new AbortController().signal,
    }
    for (const format of ['text', 'md'] as const) {
      for (const option of [`--format ${format}`, `--format=${format}`]) {
        const h = entry()
        const result = await h.reports.acp.execute(`--from saved.json ${option}`, context)
        expect(result).toEqual({
          code: 0,
          text: RENDERERS[format](h.document, 'en', REPORT_THEME),
        })
        expect(h.servicesFor).not.toHaveBeenCalled()
      }
    }
    const textOnly = entry()
    expect(
      await textOnly.reports.acp.execute('--from saved.json', { ...context, format: 'text' }),
    ).toEqual({ code: 0, text: RENDERERS.text(textOnly.document, 'en', REPORT_THEME) })
    for (const adapterFormat of ['md', 'text'] as const) {
      const refusedFormats = adapterFormat === 'text' ? ['md', 'html', 'json'] : ['html', 'json']
      for (const format of refusedFormats) {
        const h = entry()
        expect(
          await h.reports.acp.execute(`project --format ${format}`, {
            ...context,
            format: adapterFormat,
          }),
        ).toMatchObject({ code: 2 })
        expect(h.servicesFor).not.toHaveBeenCalled()
        expect(h.generate).not.toHaveBeenCalled()
        expect(h.history.save).not.toHaveBeenCalled()
      }
    }
  })
})
