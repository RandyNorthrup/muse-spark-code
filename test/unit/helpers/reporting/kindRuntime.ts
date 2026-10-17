import path from 'node:path'
import { vi } from 'vitest'
import { EN } from '../../../../src/shared/l10n/en'
import { createReportingServices } from '../../../../src/runtime/reporting/engine'
import { finalizeReport } from '../../../../src/core/reporting/render/canonical'
import type { ReportOptions, ReportDocument } from '../../../../src/shared/reportSchema'
import type { ReportsCommandDeps } from '../../../../src/runtime/reporting/reportsCommand'
import { REPORT_THEME, renderFixture } from '../../reportKindRenderFixtures'

export const REPORT_AS_OF = '2026-10-06T12:00:00+00:00'

/** Real engine services over a fixture workspace (English table, no history). */
export function reportingServicesFor(workspace: string) {
  return createReportingServices({
    workspaceRoot: workspace,
    storageRoot: path.join(workspace, 'reports'),
    l10n: { table: EN, locale: 'en' },
    generatorVersion: 'test',
    keepHistory: false,
    enabledAgents: [],
  })
}

export function reportsHarness(overrides: Partial<ReportsCommandDeps> = {}) {
  const document = renderFixture()
  const generate = vi.fn((options: ReportOptions) =>
    Promise.resolve({
      status: 'generated' as const,
      document: finalizeReport({
        ...renderFixture(options.kind),
        header: {
          ...document.header,
          kind: options.kind,
          scope: options.scope,
          asOf: options.asOf,
        },
      }),
    }),
  )
  const history = {
    list: vi.fn(() => Promise.resolve([{ id: 'saved-1', header: document.header }])),
    get: vi.fn(() => Promise.resolve(document)),
    save: vi.fn(() => Promise.resolve()),
  }
  const now = vi.fn(() => REPORT_AS_OF)
  const readSaved = vi.fn<(file: string) => Promise<ReportDocument>>(() =>
    Promise.resolve(document),
  )
  const writeOut = vi.fn<(file: string, text: string) => Promise<void>>(() => Promise.resolve())
  const stdout = vi.fn<(text: string) => void>()
  const stderr = vi.fn<(text: string) => void>()
  const deps: ReportsCommandDeps = {
    text: EN,
    services: { generate, history, conditions: () => [] },
    now,
    readSaved,
    writeOut,
    stdout,
    stderr,
    keepHistory: false,
    locale: 'en',
    theme: REPORT_THEME,
    localePort: { textForLocale: () => EN },
    ...overrides,
  }
  return { deps, document, generate, history, now, readSaved, writeOut, stdout, stderr }
}
