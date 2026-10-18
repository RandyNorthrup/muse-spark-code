import { asEstimateDiagnostic } from '../../src/core/estimator/diagnostic'
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { sharedValidation } from '../../scripts/lib/sharedValidation.mjs'
import path from 'node:path'
import ts from 'typescript'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { buildEstimateDag } from '../../src/core/estimator/dag'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { createAcpEstimate } from '../../src/acp/estimate'
import { estimateFailureText, runEstimateCommand } from '../../src/runtime/estimator/command'
import { EstimateViewSession } from '../../src/runtime/estimator/session'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { canonicalRecord } from '../../src/core/estimator/calibration/records'
import { prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import { scheduleFleet, scheduleLane } from './helpers/estimatorKindScheduleFixtures'
import { goalLane } from './helpers/estimatorKindGoalFixtures'

const asOf = '2026-10-11T12:00:00.000Z'
const context = { asOf, optimize: 'cost' } as const
const money = { price: () => '' }
const unsubscribe = () => undefined
const finished = { subscribe: () => unsubscribe }
const invalidHistory = () => canonicalRecord({})
const artifacts = { root: '', entry: '' }
beforeAll(async () => {
  artifacts.root = mkdtempSync(path.join(tmpdir(), 'm117-diagnostic-'))
  artifacts.entry = path.join(artifacts.root, 'diagnostic.js')
  const options = {
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  } as const
  await build({
    ...options,
    entryPoints: ['src/core/estimator/diagnostic.ts'],
    outfile: artifacts.entry,
    plugins: [sharedValidation],
  })
  await build({
    ...options,
    entryPoints: ['src/shared/validationEntry.ts'],
    outfile: path.join(artifacts.root, 'validation.js'),
  })
})
afterAll(() => {
  if (artifacts.root !== '') rmSync(artifacts.root, { recursive: true, force: true })
})

function failure(run: () => unknown): unknown {
  try {
    run()
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected refusal')
}
function inventory(directory: string): { site: string; kind: string; expression: string }[] {
  return readdirSync(directory, { withFileTypes: true })
    .toSorted((left, right) => (left.name < right.name ? -1 : Number(left.name > right.name)))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) return inventory(file)
      if (!file.endsWith('.ts')) return []
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      const sites: { site: string; kind: string; expression: string }[] = []
      const visit = (node: ts.Node): void => {
        const site = `${file.replaceAll('\\', '/')}:${String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)}`
        if (ts.isThrowStatement(node))
          sites.push({ site, kind: 'throw', expression: node.expression.getText(source) })
        if (ts.isNewExpression(node) && node.expression.getText(source).endsWith('Error'))
          sites.push({ site, kind: 'producer', expression: node.expression.getText(source) })
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'parse'
        )
          sites.push({
            site,
            kind: 'schema',
            expression: node.expression.expression.getText(source),
          })
        if (
          (ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            ['refuse', 'invalid', 'schedulingRefusal', 'calibrationFailure'].includes(
              node.expression.text,
            )) ||
          (ts.isNewExpression(node) &&
            node.expression.getText(source) === 'EstimateDiagnosticError')
        ) {
          const argument = node.arguments?.[0]
          if (argument && (ts.isStringLiteral(argument) || ts.isTemplateExpression(argument))) {
            const detail = ts.isStringLiteral(argument) ? argument.text : argument.head.text
            sites.push({ site, kind: 'code', expression: detail.split(':', 1)[0]?.trim() ?? '' })
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      return sites
    })
}

describe('M117 R6 diagnostic refusals', () => {
  it('loads and renders through the production shared validation bundle', () => {
    const script =
      'const diagnostic = require(process.argv[1]); process.stdout.write(diagnostic.estimateFailureText(new diagnostic.EstimateDiagnosticError("self-dependency: Q")));'
    const child = spawnSync(process.execPath, ['-e', script, artifacts.entry], { encoding: 'utf8' })
    expect(child.status, child.stderr.slice(-1000)).toBe(0)
    expect(child.stdout).toBe(fill(UI_TEXT.estimateFailed, { detail: 'self-dependency: Q' }))
  })
  it.each([
    ...inventory('src/core/estimator'),
    ...inventory('src/shared').filter(({ site }) =>
      site.startsWith('src/shared/estimateDiagnostic.ts:'),
    ),
    ...inventory('src/runtime/estimator'),
    ...inventory('src/host/estimator'),
    ...inventory('src/acp').filter(({ site }) => site.startsWith('src/acp/estimate.ts:')),
  ])('guards $kind at $site: $expression', ({ kind, expression }) => {
    switch (kind) {
      case 'throw': {
        expect(expression).toMatch(
          /^(?:new Estimate(?:Diagnostic|Scheduling)Error\(|calibrationFailure\(|asEstimateDiagnostic\()/,
        )
        break
      }
      case 'producer': {
        expect(expression).toMatch(/^Estimate(?:Diagnostic|Scheduling)Error$/)
        break
      }
      case 'schema': {
        expect(expression).toMatch(/^(?:Date|JSON)$/)
        break
      }
      default: {
        if (expression === 'estimate-unavailable')
          expect(estimateFailureText({ estimateDiagnostic: expression })).toBe(
            fill(UI_TEXT.estimateFailed, { detail: expression }),
          )
        else
          expect(estimateFailureText({ estimateDiagnostic: expression })).not.toContain(
            'estimate-unavailable',
          )
      }
    }
  })
  it.each(['self-dependency', 'cycle'])(
    'preserves %s through CLI, ACP and the view in the installed language',
    async (code) => {
      const lanes =
        code === 'self-dependency'
          ? [goalLane('M112:Q', { dependencies: ['M112:Q'] })]
          : [
              goalLane('M112:Q', { dependencies: ['M112:A'] }),
              goalLane('M112:A', { dependencies: ['M112:Q'] }),
            ]
      const runner = { estimate: () => Promise.resolve(buildEstimateDag(lanes)) }
      const error = failure(() => buildEstimateDag(lanes))
      setUiText({ ...EN, estimateFailed: 'Refus local: {detail}' }, 'fr')
      try {
        expect(error).toHaveProperty('estimateDiagnostic', expect.stringContaining(code))
        const expected = estimateFailureText(error)
        expect(expected).toContain('Refus local: ')
        expect(expected).toContain(code)
        expect(expected).toContain('M112:Q')
        const outputLines: unknown[][] = []
        const output = (...args: unknown[]) => {
          outputLines.push(args)
        }
        expect(
          await runEstimateCommand(['M112'], {
            context: () => context,
            runner,
            money,
            write: () => undefined,
            error: output,
            signal: new AbortController().signal,
          }),
        ).toBe(1)
        expect(outputLines).toEqual([[expected]])
        const acp = createAcpEstimate({ context: () => context, runner: () => runner, money })
        expect(await acp.run('/estimate M112', '/workspace', new AbortController().signal)).toBe(
          expected,
        )
        const view = new EstimateViewSession(
          { goal: { kind: 'milestone', milestoneId: 'M112' }, fleet: 'current', format: 'text' },
          context,
          runner,
          finished,
          (state) => {
            if (state.status === 'failed') output(estimateFailureText(state.diagnostic))
          },
        )
        await view.refresh()
        view.dispose()
        expect(outputLines.at(-1)).toEqual([expected])
      } finally {
        setUiText(EN, BASE_LOCALE)
      }
    },
  )
  it('preserves typed diagnostics from other bundles through wrapping adapters', () => {
    const foreign = { estimateDiagnostic: 'cycle: M112:Q', message: '/private/raw-message' }
    const wrapped = asEstimateDiagnostic(foreign, 'historyReadFailed')
    expect(wrapped.estimateDiagnostic).toBe(foreign.estimateDiagnostic)
    expect(estimateFailureText(wrapped)).toBe(
      fill(UI_TEXT.estimateFailed, { detail: foreign.estimateDiagnostic }),
    )
    expect(estimateFailureText(wrapped)).not.toContain('/private')
  })
  it('retains calibration and resource refusal identities', () => {
    const fleet = scheduleFleet(1)
    fleet.slots = []
    for (const [run, detail] of [
      [invalidHistory, 'invalidHistory'],
      [() => prepareEstimateSchedule([scheduleLane('Q')], fleet).run(), 'unschedulable:Q'],
    ] as const) {
      const error = failure(run)
      expect(error).toHaveProperty('estimateDiagnostic', detail)
      expect(estimateFailureText(error)).toContain(detail)
    }
  })
  it('types schema refusals and rejects unknown codes, private paths and injected lines', () => {
    const lane = goalLane('Q')
    lane.estimatedHours = -1
    const error = failure(() => buildEstimateDag([lane]))
    expect(error).toHaveProperty('estimateDiagnostic', 'invalid-input')
    expect(estimateFailureText(error)).toContain('invalid-input')
    for (const estimateDiagnostic of [
      'future-code',
      'self-dependency: /private/account',
      'self-dependency: Q; future-code',
      'self-dependency: Q\nprivate',
    ]) {
      expect(estimateFailureText({ estimateDiagnostic })).toBe(
        fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }),
      )
    }
  })
  it('preserves collected reader and grammar refusals and masks raw errors', () => {
    for (const starts of ['after missing', 'after prose interface']) {
      const plan = `## 6. Milestones\n\n### M112 — Work\n\n**Status 2026-10-10: planned.**\n\n| Lane | Items | Starts | Hours |\n| --- | --- | --- | --- |\n| Q | 1 | ${starts} | 4 |\n`
      const error = failure(() =>
        buildPlanSnapshot(plan, { kind: 'milestone', milestoneId: 'M112' }, asOf),
      )
      expect(estimateFailureText(error)).toContain(
        starts === 'after missing' ? 'unknown-prerequisite' : 'malformed-starts',
      )
    }
    expect(estimateFailureText(new Error('/private/account'))).toBe(
      fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }),
    )
  })
})
