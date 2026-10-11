import { createRoot } from 'react-dom/client'
import { fakeEstimate, fakeDisclosures } from '../../unit/helpers/estimator/fixtures'
import { type EstimateSection } from '../../../src/shared/estimate'

/** Mutation-driven harness scenarios; no delay guesses or production fakes. */
function whenFound(selector: string, run: (element: Element) => void): void {
  const existing = document.querySelector(selector)
  if (existing !== null) {
    run(existing)
    return
  }
  const observer = new MutationObserver(() => {
    const element = document.querySelector(selector)
    if (element === null) return
    observer.disconnect()
    run(element)
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function evidence(section: EstimateSection): EstimateSection {
  section.disclosures = fakeDisclosures(section).map((row) => ({
    ...row,
    uncertainty: { kind: 'unknown' },
  }))
  return section
}

async function mount(): Promise<void> {
  const { default: EstimatorPanel } = await import('../../../src/webview/estimator/EstimatorPanel')
  const root = document.querySelector('#root')
  if (root === null) throw new Error('missing harness root')
  let current = fakeEstimate()
  const first = current.setups[0]
  if (first === undefined) throw new Error('missing fixture setup')
  let emit: ((value: unknown) => void) | undefined
  current.setups.push(
    ...(['minimumP50', 'minimumP90', 'optimumCost', 'optimumSpeed'] as const).map((kind) => ({
      ...structuredClone(first),
      kind,
      provisioning: 'adviceOnly' as const,
    })),
  )
  current = evidence(current)
  createRoot(root).render(
    <EstimatorPanel
      initial={current.inputs.request}
      port={{
        context: () => ({ asOf: current.asOf, optimize: 'cost' }),
        estimate: (request) => {
          const section = structuredClone(current)
          section.inputs.request = request
          return Promise.resolve(evidence(section))
        },
        subscribe: (listener) => {
          emit = listener
          return () => {
            emit = undefined
          }
        },
        price: () => 'exact fixture USD',
        provision: { state: 'waiting', dependency: 'M117-P-start' },
      }}
    />,
  )
  whenFound('button[type="submit"]', (element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error('not a button')
    element.click()
  })
  whenFound('.estimator-gantt', () => {
    document.body.dataset['estimatorReady'] = 'true'
  })
  window.addEventListener('fixture-lane-finished', () => {
    const previous = current.asOf
    current.asOf = '2026-10-06T12:30:00.000Z'
    current.inputs.request.asOf = current.asOf
    current.inputs.fleet.asOf = current.asOf
    current.p50 = '2026-10-06T14:00:00.000Z'
    current.p90 = '2026-10-06T15:00:00.000Z'
    current.drift = { previousAsOf: previous, p50Hours: 1, p90Hours: 1 }
    if (emit === undefined) throw new Error('missing view subscription')
    emit(evidence(current))
  })
}

void mount()
