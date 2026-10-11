import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { REPORT_KINDS } from '../../src/shared/constants'
import {
  reportDocumentSchema,
  reportSectionSchema,
  type ReportKind,
} from '../../src/shared/reportSchema'
import { collectFixture, facet, fullSnapshot } from './helpers/reporting/collect'
import { availableSource, unavailableSource } from './helpers/reporting/snapshot'

const root = path.resolve(import.meta.dirname, '../..')
const folder = path.join(root, 'src/core/reporting/collect')
// Explicit duplicate cases, not incidental sections seen while testing another
// source. Every AST row call must have a case; every section must grow in one.
const casesByKind: Record<ReportKind, string> = {
  project:
    'common.ts:sourcedSection:0 needsYou.ts:needsYou:1 needsYou.ts:needsYou:3 needsYou.ts:needsYou:4 plan.ts:planFormat:1 plan.ts:laneRows:0 plan.ts:deliveryRows:0 plan.ts:planRiskRows:0 plan.ts:planResidualRows:0 repository.ts:projectReleaseRows:0 repository.ts:channelRows:0 repository.ts:channelRows:1 repository.ts:ciSection:0 repository.ts:pullRequests:0 repository.ts:collectProject:0 usage.ts:usageSections:0 usage.ts:usageSections:1 usage.ts:usageSections:2',
  milestone:
    'plan.ts:collectMilestone:0 plan.ts:collectMilestone:1 plan.ts:collectMilestone:2 plan.ts:collectMilestone:3 plan.ts:collectMilestone:4 plan.ts:collectMilestone:5 plan.ts:laneRows:0 plan.ts:planRiskRows:0 plan.ts:planResidualRows:0 plan.ts:planQuestionRows:0 common.ts:certificationRows:0',
  release:
    'repository.ts:collectRelease:0 repository.ts:collectRelease:1 repository.ts:collectRelease:2 repository.ts:collectRelease:3 repository.ts:collectRelease:4 repository.ts:channelRows:0 repository.ts:channelRows:1 repository.ts:ciSection:0',
  changes:
    'repository.ts:collectChanges:0 repository.ts:collectChanges:1 repository.ts:collectChanges:2 repository.ts:pullRequests:0',
  quality:
    'quality.ts:collectQuality:0 quality.ts:collectQuality:1 common.ts:checkRows:0 common.ts:certificationRows:0 repository.ts:ciSection:0',
  session:
    'session.ts:collectSession:0 session.ts:collectSession:1 session.ts:collectSession:2 session.ts:collectSession:3 session.ts:collectSession:4 session.ts:collectSession:5 session.ts:collectSession:6 needsYou.ts:needsYou:2 plan.ts:planQuestionRows:0 common.ts:checkRows:0 usage.ts:usageSections:0 usage.ts:usageSections:1 usage.ts:usageSections:2',
  usage:
    'usage.ts:usageSections:0 usage.ts:usageSections:1 usage.ts:usageSections:2 usage.ts:otherAgentUsage:0 usage.ts:otherAgentLimits:0',
  fleet: 'index.ts:forward:0',
  security: 'index.ts:forward:0',
  accounts: 'index.ts:forward:0',
  estimate: 'index.ts:forward:0',
  playbook: 'index.ts:forward:0',
  issues: 'index.ts:forward:0',
  schedules: 'index.ts:forward:0',
  keybindings: 'index.ts:forward:0',
}
const forwardedFacets = {
  fleet: 'agents workers devices nodes',
  security: 'vault breakdown grants usage denials locks developerAudit',
  accounts: 'accounts limits usage swaps refusals confirmations',
  estimate: 'totals criticalPath limitingResource setups inputs calibration',
  playbook: 'totals decisions drills disabledRules refusals',
  issues: 'issues limits',
  schedules: 'timeline schedules fires refusals cost',
  keybindings: 'keybindings conflicts',
}
const table = REPORT_KINDS.flatMap((kind) =>
  [...casesByKind[kind].split(/\s+/), 'needsYou.ts:needsYou:0', 'plan.ts:planFormat:0'].map(
    (source) => ({
      kind,
      source,
    }),
  ),
)
const inventory = new Set<string>()
const forwardedRegistry: Record<string, string[]> = {}
const coveredSections = new Map<string, Set<string>>()
interface Probe {
  collect: typeof collectFixture
  target: (source: string) => void
  keys: () => string[]
}
const state: { probe?: Probe } = {}

function instrument(name: string, text: string): string {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
  const rowNames = new Set(['row'])
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings !== undefined && ts.isNamedImports(bindings))
      for (const entry of bindings.elements) {
        if ((entry.propertyName ?? entry.name).text === 'row') rowNames.add(entry.name.text)
      }
  }
  const ordinals = new Map<string, number>()
  const edits: { at: number; text: string }[] = []
  const wrap = (node: ts.Node, fn: string, hasRows = false) => {
    const ordinal = ordinals.get(fn) ?? 0
    ordinals.set(fn, ordinal + 1)
    const id = `${name}:${fn}:${String(ordinal)}`
    inventory.add(id)
    edits.push(
      {
        at: node.getStart(file),
        text: `${hasRows ? '__captureRows' : '__capture'}(${JSON.stringify(id)}, `,
      },
      { at: node.end, text: ')' },
    )
  }
  const visit = (node: ts.Node) => {
    const containerNode = ts.isSourceFile(node) ? node : node.parent
    let parent = containerNode
    while (!ts.isFunctionDeclaration(parent) && !ts.isSourceFile(parent)) parent = parent.parent
    const owner = ts.isFunctionDeclaration(parent) ? (parent.name?.text ?? '') : ''
    if (ts.isCallExpression(node) && rowNames.has(node.expression.getText(file))) wrap(node, owner)
    const properties = ts.isObjectLiteralExpression(containerNode) ? containerNode.properties : []
    // Direct row objects are sources too; row() itself is their shared factory.
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(file) === 'key' &&
      !(name === 'common.ts' && owner === 'row') &&
      ts.isObjectLiteralExpression(containerNode) &&
      ['cells', 'sourceIds'].every((field) =>
        properties.some((property) => property.name?.getText(file) === field),
      )
    )
      wrap(node.parent, owner)
    if (
      name === 'index.ts' &&
      ts.isPropertyAccessExpression(node) &&
      node.getText(file) === 'parsed.rows'
    )
      wrap(node, owner, true)
    if (
      name === 'common.ts' &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'section' &&
      node.body !== undefined
    )
      edits.push({ at: node.body.getStart(file) + 1, text: '\nrows = __duplicate(rows);\n' })
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === 'forwardedKinds' &&
      node.initializer !== undefined
    ) {
      const object = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      if (ts.isObjectLiteralExpression(object))
        for (const field of object.properties) {
          if (ts.isPropertyAssignment(field) && ts.isArrayLiteralExpression(field.initializer))
            forwardedRegistry[field.name.getText(file)] = field.initializer.elements.map((entry) =>
              ts.isStringLiteral(entry) ? entry.text : entry.getText(file),
            )
        }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  const orderedEdits = edits.toSorted((left, right) => right.at - left.at)
  for (const edit of orderedEdits) text = text.slice(0, edit.at) + edit.text + text.slice(edit.at)
  return `import { capture as __capture, captureRows as __captureRows, duplicate as __duplicate } from 'row-probe';\n${text}`
}

beforeAll(async () => {
  // Build once in memory. Instrument the actual source constructors and inject
  // a duplicate only for the named source at the section boundary, including
  // singleton/aggregated sources which raw facts cannot naturally repeat.
  const result = await build({
    stdin: {
      contents:
        "export { collectFixture as collect } from './test/unit/helpers/reporting/collect'; export { target, keys } from 'row-probe';",
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'row-source-probe',
        setup(build) {
          build.onResolve({ filter: /^row-probe$/ }, () => ({
            path: 'row-probe',
            namespace: 'probe',
          }))
          build.onLoad({ filter: /.*/, namespace: 'probe' }, () => ({
            contents: `
        let selected = ''; const seen = new Set();
        export function target(id) { selected = id; seen.clear(); }
        export function keys() { return [...seen]; }
        export function capture(id, row) { if (id === selected) seen.add(row.key); return row; }
        export function captureRows(id, rows) { return rows.map(row => capture(id, row)); }
        export function duplicate(rows) { return rows.flatMap(row => seen.has(row.key) ? [row, { ...row }] : [row]); }
      `,
            loader: 'js',
          }))
          build.onLoad(
            { filter: /[/\\]core[/\\]reporting[/\\]collect[/\\].*\.ts$/ },
            async ({ path: filename }) => ({
              contents: instrument(path.basename(filename), await readFile(filename, 'utf8')),
              loader: 'ts',
              resolveDir: path.dirname(filename),
            }),
          )
        },
      },
    ],
  })
  const container: { exports: unknown } = { exports: {} }
  runInNewContext(result.outputFiles[0]!.text, {
    module: container,
    exports: container.exports,
    require: createRequire(import.meta.url),
    process,
    Buffer,
    TextEncoder,
    TextDecoder,
  })
  const value = container.exports
  if (!isProbe(value)) throw new Error('Invalid row probe exports')
  state.probe = value
})

function isProbe(value: unknown): value is Probe {
  return (
    typeof value === 'object' &&
    value !== null &&
    'collect' in value &&
    typeof value.collect === 'function' &&
    'target' in value &&
    typeof value.target === 'function' &&
    'keys' in value &&
    typeof value.keys === 'function'
  )
}

function snapshotFor(source: string, kind: ReportKind) {
  const snapshot = fullSnapshot()
  const sources = { ...snapshot.sources }
  switch (source) {
    case 'common.ts:sourcedSection:0': {
      sources.usage = unavailableSource('usage')
      break
    }
    case 'needsYou.ts:needsYou:1':
    case 'plan.ts:planFormat:1': {
      sources.plan = availableSource('plan', {
        ...sources.plan.data!,
        drift: [{ code: 'question-duplicate', line: 1, detail: 'Q-M12' }],
      })
      break
    }
    case 'session.ts:collectSession:0': {
      sources.session = availableSource('session', {
        ...sources.session.data!,
        activity: {
          ...sources.session.data!.activity,
          approvals: { status: 'unavailable', reason: 'Not recorded' },
        },
      })
      break
    }
    default: {
      if (kind === 'changes')
        sources.github = availableSource('github', {
          ...sources.github.data!,
          pullRequests: sources.github.data!.pullRequests.map((pull) => ({
            ...pull,
            isMerged: true,
          })),
        })
    }
  }
  const facets = Object.entries(forwardedFacets).find(([name]) => name === kind)?.[1]
  if (facets !== undefined)
    return {
      ...snapshot,
      sources: {
        ...sources,
        [kind]: availableSource(
          kind,
          facets
            .split(' ')
            .map((heading) => facet(kind, reportSectionSchema.shape.label.parse(heading))),
        ),
      },
    }
  return { ...snapshot, sources }
}

describe('collector duplicate source coverage', () => {
  it.each(table)('$kind duplicates the actual row source $source', ({ kind, source }) => {
    const probe = state.probe
    if (probe === undefined) throw new Error('Row probe was not built')
    const snapshot = snapshotFor(source, kind)
    probe.target('')
    const before = probe.collect(kind, { full: true }, snapshot)
    probe.target(source)
    const document = reportDocumentSchema.parse(probe.collect(kind, { full: true }, snapshot))
    const keys = new Set(probe.keys())
    expect(keys.size, `${source} must actually construct a row`).toBeGreaterThan(0)
    const seen = coveredSections.get(kind) ?? new Set<string>()
    let duplicatedSections = 0
    for (const section of [before.needsYou, ...before.sections]) {
      const duplicated = section.rows.filter((row) => keys.has(row.key)).length
      if (duplicated === 0) continue
      const result = [document.needsYou, ...document.sections].find(
        (entry) => entry.id === section.id,
      )!
      expect(result.rows).toHaveLength(section.rows.length + duplicated)
      expect(new Set(result.rows.map((row) => row.key)).size).toBe(result.rows.length)
      seen.add(section.id)
      duplicatedSections += 1
    }
    expect(duplicatedSections).toBeGreaterThan(0)
    coveredSections.set(kind, seen)
  })

  it('binds every collector row call and registry facet to an explicit duplicate case', async () => {
    // Enumerate every module, even if a future registry entry forgets to import
    // it. Importing a new row source cannot silently inherit section coverage.
    const names = await readdir(folder)
    for (const name of names) {
      if (name.endsWith('.ts')) instrument(name, await readFile(path.join(folder, name), 'utf8'))
    }
    expect(new Set(table.map(({ source }) => source))).toEqual(inventory)
    expect(forwardedRegistry).toEqual(
      Object.fromEntries(
        Object.entries(forwardedFacets).map(([kind, headings]) => [kind, headings.split(' ')]),
      ),
    )
  })

  it.each([...REPORT_KINDS])(
    '%s has an actual duplicate case for every emitted section',
    (kind) => {
      const clean = collectFixture(kind, { full: true }, snapshotFor('', kind))
      expect(coveredSections.get(kind)).toEqual(
        new Set([clean.needsYou.id, ...clean.sections.map(({ id }) => id)]),
      )
    },
  )

  it('pre-parse property guards use compiler-visible narrowing without type assertions', async () => {
    const file = ts.createSourceFile(
      'common.ts',
      await readFile(path.join(folder, 'common.ts'), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const assertions: string[] = []
    const visit = (node: ts.Node) => {
      if (ts.isAsExpression(node) && node.type.getText(file) !== 'const')
        assertions.push(node.getText(file))
      ts.forEachChild(node, visit)
    }
    visit(file)
    expect(assertions).toEqual([])
  })
})
