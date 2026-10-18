// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import {
  EstimateDiagnosticError,
  estimateFailureText,
  type EstimateDiagnostic,
  type EstimateViewState,
} from '../../src/shared/estimateDiagnostic'
import { createAcpEstimate } from '../../src/acp/estimate'
import { runEstimateCommand } from '../../src/runtime/estimator/command'
import { EstimateViewSession, openEstimateTui } from '../../src/runtime/estimator/session'
import { parseHostToEstimatorMessage } from '../../src/shared/estimatorProtocol'
import EstimatorPanel, { type EstimatorPanelPort } from '../../src/webview/estimator/EstimatorPanel'
import { createUiStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { buildEstimateDag } from '../../src/core/estimator/dag'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { sectionVector } from './helpers/estimator/sectionVectors'
import {
  ESTIMATE_DIAGNOSTIC_CASES,
  ESTIMATE_SURFACES,
  diagnosticSentence,
} from './helpers/estimator/diagnosticMatrix'

const plan = (starts: string) =>
  `## 6. Milestones\n\n### M112 — Questions\n\n**Status 2026-10-10: planned.**\n\n| Lane | Items | Starts | Hours |\n| --- | --- | --- | --- |\n| Q | 1 | ${starts} | 4 |\n`
const byText = (a: string, b: string) => (a < b ? -1 : Number(a > b))
const section = sectionVector()
const context = { asOf: section.asOf, optimize: 'cost' } as const
const options = { goal: section.inputs.request.goal, fleet: 'current', format: 'text' } as const
const money = { price: () => 'test-price' }
const unsubscribe = () => undefined
const finished = { subscribe: () => unsubscribe }
const runner = (diagnostic: EstimateDiagnostic) => {
  let calls = 0
  return {
    estimate: () => {
      calls += 1
      if (calls === 1) return Promise.resolve(section)
      // The runner port refuses exactly as the production engine does: an
      // EstimateDiagnosticError carrying the code, which every surface
      // normalizes back to its installed-language sentence.
      return Promise.reject(new EstimateDiagnosticError(diagnostic.estimateDiagnostic))
    },
  }
}
const port = (diagnostic: EstimateDiagnostic): EstimatorPanelPort => ({
  context: () => context,
  estimate: () => Promise.resolve(diagnostic),
  subscribe: () => unsubscribe,
  startExisting: () => Promise.resolve(diagnostic),
  price: () => 'test-price',
  provision: { state: 'waiting', dependency: 'test-provider' },
})

function mountForecast(adapter: EstimatorPanelPort, first = section) {
  return render(
    <EstimatorPanel
      port={adapter}
      initial={first.inputs.request}
      initialState={{ status: 'showing', section: first }}
    />,
  )
}
async function pressEstimate(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
    await Promise.resolve()
  })
}
function expectRefusal(code: string) {
  expect(screen.getByRole('alert').textContent).toBe(diagnosticSentence(code))
  expect(screen.queryByRole('heading', { name: UI_TEXT.estimateSchedule })).toBeNull()
}

afterEach(() => {
  cleanup()
  setUiText(EN, BASE_LOCALE)
})

const surfaces = {
  cli: async (diagnostic: EstimateDiagnostic, text: string) => {
    const outputLines: unknown[][] = []
    const errorLines: unknown[][] = []
    const output = (...args: unknown[]) => {
      outputLines.push(args)
    }
    const error = (...args: unknown[]) => {
      errorLines.push(args)
    }
    const deps = {
      context: () => context,
      runner: runner(diagnostic),
      money,
      write: output,
      error,
      signal: new AbortController().signal,
    }
    expect(await runEstimateCommand(['M117'], deps)).toBe(0)
    outputLines.length = 0
    expect(await runEstimateCommand(['M117'], deps)).toBe(1)
    expect(errorLines.at(-1)).toEqual([text])
    expect(outputLines).toHaveLength(0)
  },
  acp: async (diagnostic: EstimateDiagnostic, text: string) => {
    const run = runner(diagnostic)
    const acp = createAcpEstimate({ context: () => context, runner: () => run, money })
    await acp.run('/estimate M117', '/workspace', new AbortController().signal)
    expect(await acp.run('/estimate M117', '/workspace', new AbortController().signal)).toBe(text)
  },
  session: async (diagnostic: EstimateDiagnostic, text: string) => {
    const states: EstimateViewState[] = []
    const view = new EstimateViewSession(
      options,
      context,
      runner(diagnostic),
      finished,
      (state) => {
        states.push(state)
      },
    )
    await view.refresh()
    expect(states.at(-1)?.status).toBe('showing')
    await view.refresh()
    expect(states.at(-1)).toEqual({ status: 'failed', diagnostic })
    const state = states.at(-1)
    expect(state).not.toHaveProperty('section')
    expect(state?.status === 'failed' && estimateFailureText(state.diagnostic)).toBe(text)
    view.dispose()
  },
  card: async (diagnostic: EstimateDiagnostic, text: string) => {
    const adapter = port(diagnostic)
    const store = createUiStore(initialUiState)
    store.dispatch({ type: 'hostMessage', at: 0, message: { type: 'estimatorSection', section } })
    const mounted = render(
      <EstimatorPanel
        port={adapter}
        initial={section.inputs.request}
        initialState={store.getState().estimator}
      />,
    )
    expect(screen.getByRole('heading', { name: UI_TEXT.estimateSchedule })).toBeTruthy()
    const frame = await parseHostToEstimatorMessage({ type: 'estimatorFailure', diagnostic })
    if (!frame.ok) throw new Error('fixture refused')
    store.dispatch({ type: 'hostMessage', at: 1, message: frame.message })
    mounted.rerender(
      <EstimatorPanel
        port={adapter}
        initial={section.inputs.request}
        initialState={store.getState().estimator}
      />,
    )
    expect(screen.getByRole('alert')).toHaveProperty('textContent', text)
    expect(screen.queryByRole('heading', { name: UI_TEXT.estimateSchedule })).toBeNull()
    expect(screen.queryByText(UI_TEXT.estimateP50)).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(store.getState().estimator).not.toHaveProperty('section')
  },
  terminal: async (diagnostic: EstimateDiagnostic, text: string) => {
    const shown: unknown[][] = []
    const show = (...args: unknown[]) => {
      shown.push(args)
    }
    const session = await openEstimateTui(options, {
      context,
      runner: runner(diagnostic),
      finished,
      money,
      view: () => ({ show }),
    })
    expect(shown.at(-1)?.[1]).toContain(UI_TEXT.estimateP50)
    await session.refresh()
    expect(shown.at(-1)).toEqual([UI_TEXT.estimateTitle, text])
    session.dispose()
  },
}

describe('M117 diagnostic × real surface replacement table', () => {
  it('covers every renderer consumer and every matrix column', () => {
    expect([...Object.keys(surfaces), 'transcript'].toSorted(byText)).toEqual(
      Object.keys(ESTIMATE_SURFACES).toSorted(byText),
    )
    const files = readdirSync('src', { recursive: true, encoding: 'utf8' }).map(
      (file) => `src/${file.replaceAll('\\', '/')}`,
    )
    const consumers = files
      .filter(
        (file) =>
          /\.(?:ts|tsx)$/.test(file) &&
          ['/estimateDiagnostic.ts', '/estimateView.ts'].every(
            (suffix) => !file.replaceAll('\\', '/').endsWith(suffix),
          ) &&
          // M113's estimate source renders through the report's installed
          // table (reportText), not the global one.
          /\bestimateFailureText\(|\bUI_TEXT\.estimateFailed\b|\breportText\.estimateFailed\b/.test(
            readFileSync(file, 'utf8'),
          ),
      )
      .map((file) => file.replaceAll('\\', '/'))
      .toSorted(byText)
    expect(consumers).toEqual(
      [
        ...new Set(Object.values(ESTIMATE_SURFACES).flat()),
        // M113's estimate report kind renders the same refusal sentences in
        // the report's language (its factory snapshot, or the installed
        // table for factory-less readers).
        'src/core/reporting/sources/estimate.ts',
        'src/host/views/webviewSetup.ts',
      ].toSorted(byText),
    )
  })
  it.each(
    ESTIMATE_DIAGNOSTIC_CASES.flatMap(({ code, diagnostic }) =>
      Object.entries(surfaces).map(([surface, check]) => ({ code, diagnostic, surface, check })),
    ),
  )(
    '$code → $surface replaces the previous section with its installed-language sentence',
    async ({ diagnostic, check }) => {
      // Install after the diagnostic exists, as lazy browser/node bundles do.
      setUiText({ ...EN, estimateFailed: 'Refus local: {detail}' }, 'fr')
      await check(diagnostic, diagnosticSentence(diagnostic.estimateDiagnostic))
    },
  )
  it.each(ESTIMATE_DIAGNOSTIC_CASES)(
    '$code survives real card refresh and spin-up refusals',
    async ({ diagnostic }) => {
      const stablePort = port(diagnostic)
      const mounted = mountForecast(stablePort)
      await pressEstimate(UI_TEXT.estimateRefresh)
      expectRefusal(diagnostic.estimateDiagnostic)
      mounted.unmount()
      mountForecast(stablePort)
      await pressEstimate(UI_TEXT.estimateSpinUp)
      expectRefusal(diagnostic.estimateDiagnostic)
    },
  )
  it('M112:Q succeeds, then Starts after lane Q refuses Re-estimate and clears every row', async () => {
    const goal = { kind: 'milestone', milestoneId: 'M112' } as const
    const forecast = (starts: string) =>
      buildEstimateDag(
        buildPlanSnapshot(plan(starts), goal, context.asOf).lanes.map(({ lane }) => lane),
      )
    forecast('day 0')
    const first = structuredClone(section)
    first.inputs.request.goal = goal
    first.inputs.lanes = first.inputs.lanes.map((lane) => ({
      ...lane,
      id: 'M112:Q',
      dependencies: [],
    }))
    first.schedule = first.schedule.map((row) => ({ ...row, laneId: 'M112:Q' }))
    first.criticalPath = ['M112:Q']
    const adapter = port({ estimateDiagnostic: 'estimate-unavailable' })
    adapter.estimate = () => {
      forecast('after lane Q')
      return Promise.resolve(first)
    }
    mountForecast(adapter, first)
    await pressEstimate(UI_TEXT.estimateRefresh)
    expectRefusal('self-dependency: M112:Q')
    expect(screen.queryByText(UI_TEXT.estimateP90)).toBeNull()
  })
  it.each(['future-code', 'self-dependency: /private/account', 'cycle: Q\nprivate'])(
    'refuses an unvalidated diagnostic %s at the message boundary',
    async (estimateDiagnostic) => {
      const sectionFrame = await parseHostToEstimatorMessage({
        type: 'estimatorSection',
        section: { ...section, currentRefusal: estimateDiagnostic },
      })
      const failureFrame = await parseHostToEstimatorMessage({
        type: 'estimatorFailure',
        diagnostic: { estimateDiagnostic },
      })
      const startFrame = await parseHostToEstimatorMessage({
        type: 'estimatorStarted',
        diagnostic: { estimateDiagnostic },
      })
      expect(sectionFrame.ok).toBe(false)
      expect(failureFrame.ok).toBe(false)
      expect(startFrame.ok).toBe(false)
    },
  )
  it('clears a previously supplied section when the initial state becomes undefined', () => {
    const adapter = port({ estimateDiagnostic: 'estimate-unavailable' })
    const mounted = render(
      <EstimatorPanel port={adapter} initialState={{ status: 'showing', section }} />,
    )
    mounted.rerender(<EstimatorPanel port={adapter} />)
    expect(screen.queryByRole('heading', { name: UI_TEXT.estimateSchedule })).toBeNull()
  })
})
