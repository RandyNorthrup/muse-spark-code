import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { afterEach, expect, it } from 'vitest'
import { REPORT_KINDS } from '../../src/shared/constants'
import { EN, type UiText } from '../../src/shared/l10n/en'
import { tableProblems } from '../../src/shared/l10n/check'
import { setUiText } from '../../src/shared/l10n/text'
import { REPORT_KIND_REGISTRY } from '../../src/core/reporting/registry'
import { createReportingServices } from '../../src/runtime/reporting/engine'
import { fullSnapshot } from './helpers/reporting/collect'
import { reportOptions, unavailableSource } from './helpers/reporting/snapshot'
import { engineSources } from './helpers/reporting/engineSources'
import { deferred } from './helpers/leaseFs'

const root = path.resolve(import.meta.dirname, '../..')
afterEach(() => {
  setUiText(EN, 'en')
})
function isTable(value: unknown): value is UiText {
  return tableProblems(EN, value, { locale: 'es', isStrict: false }).length === 0
}
const raw: unknown = JSON.parse(await readFile(path.join(root, 'l10n/ui.es.json'), 'utf8'))
if (!isTable(raw)) throw new Error('Invalid Spanish table')
const spanish = raw
const SOURCE_FILES: Record<string, string> = {
  plan: 'src/core/reporting/plan/reader.ts',
  checkRuns: 'src/core/reporting/checkRuns.ts',
  usage: 'src/core/reporting/sources/index.ts',
}

it.each(REPORT_KINDS)('%s overlapping engine generations keep their own language', async (kind) => {
  const englishWait = deferred()
  const spanishWait = deferred()
  const context = {
    workspaceRoot: root,
    storageRoot: path.join(root, 'temp/language-unused'),
    generatorVersion: 'test',
    keepHistory: false,
    enabledAgents: [],
  }
  const original = fullSnapshot()
  const snapshot = { ...original, sources: { ...original.sources, git: unavailableSource('git') } }
  // Selection graph reads are separate injected engine inputs; keep this drill
  // about source language by marking the graph unavailable in both generations.

  const english = createReportingServices({
    ...context,
    l10n: { table: EN, locale: 'en' },
    sources: engineSources(snapshot, englishWait.promise),
  })
  const other = createReportingServices({
    ...context,
    l10n: { table: spanish, locale: 'es' },
    sources: engineSources(snapshot, spanishWait.promise),
  })
  let scope = ''
  if (kind === 'milestone') scope = 'M12'
  else if (kind === 'release') scope = '0.14.2'
  const options = reportOptions(kind, { scope })
  const first = english.generate?.(options)
  const second = other.generate?.(options)
  if (first === undefined || second === undefined) throw new Error('Missing generator')
  spanishWait.resolve()
  const secondResult = await second
  setUiText(spanish, 'es')
  englishWait.resolve()
  const firstResult = await first
  if (firstResult.status !== 'generated' || secondResult.status !== 'generated')
    throw new Error('Missing report')
  const sources = REPORT_KIND_REGISTRY[kind].sources
  for (const source of sources) {
    expect(firstResult.document.sources.find((entry) => entry.id === source)?.reason).toBe(
      EN.reportSourceReasons.failed,
    )
    expect(secondResult.document.sources.find((entry) => entry.id === source)?.reason).toBe(
      spanish.reportSourceReasons.failed,
    )
  }
  expect(firstResult.document.footer.locale).toBe('en')
  expect(secondResult.document.footer.locale).toBe('es')
})

it.each(REPORT_KINDS)(
  '%s registered source and collector files import no process text table',
  async (kind) => {
    const registration = REPORT_KIND_REGISTRY[kind]
    const files = new Set<string>()
    const candidates = registration.sources.map(
      (source) => SOURCE_FILES[source] ?? `src/core/reporting/sources/${source}.ts`,
    )
    candidates.push(`src/core/reporting/collect/${registration.collector}.ts`)
    if (
      registration.sources.some((source) =>
        ['session', 'usage', 'accounts', 'security'].includes(source),
      )
    )
      candidates.push('src/runtime/reporting/reportInputs.ts')
    async function visit(relative: string): Promise<void> {
      if (files.has(relative)) return
      let source: string
      try {
        source = await readFile(path.join(root, relative), 'utf8')
      } catch {
        return
      }
      files.add(relative)
      const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true)
      for (const statement of tree.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
        )
          continue
        const bindings = statement.importClause?.namedBindings
        if (
          bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.every((entry) => entry.isTypeOnly)
        )
          continue
        if (bindings !== undefined && ts.isNamedImports(bindings))
          for (const entry of bindings.elements) {
            if (entry.isTypeOnly) continue
            expect((entry.propertyName ?? entry.name).text, relative).not.toBe('UI_TEXT')
            expect((entry.propertyName ?? entry.name).text, relative).not.toBe('uiLocale')
          }
        const name = statement.moduleSpecifier.text
        if (!name.startsWith('.')) continue
        const dependency = path
          .normalize(path.join(path.dirname(relative), name))
          .replaceAll('\\', '/')
        if (dependency.includes('/reporting/')) await visit(dependency + '.ts')
      }
    }
    for (const file of candidates) await visit(file)
    expect(files.size).toBeGreaterThan(0)
  },
)
