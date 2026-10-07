// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EstimatorPanel, { type EstimatorPanelPort } from '../../src/webview/estimator/EstimatorPanel'
import { type EstimateRequest, type EstimateSection } from '../../src/shared/estimate'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { fakeEstimate } from './helpers/estimator/fixtures'

afterEach(cleanup)
function harness() {
  let listener: (value: unknown) => void = vi.fn()
  const unsubscribe = vi.fn()
  const estimate = vi.fn((request: EstimateRequest, _signal: AbortSignal) => {
    const section = fakeEstimate()
    section.inputs.request = request
    return Promise.resolve(section)
  })
  const port: EstimatorPanelPort = {
    context: () => ({ asOf: fakeEstimate().asOf, optimize: 'cost' }),
    estimate,
    subscribe: (callback) => {
      listener = callback
      return unsubscribe
    },
    price: () => 'exact-money',
    provision: { state: 'waiting', dependency: 'M117-P-start' },
  }
  return {
    port,
    estimate,
    unsubscribe,
    emit: (value: unknown) => {
      listener(value)
    },
  }
}
async function start(port: EstimatorPanelPort) {
  render(<EstimatorPanel port={port} initial={fakeEstimate().inputs.request} />)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateRun }))
  await screen.findByRole('heading', { name: UI_TEXT.estimateSchedule })
}

/** A mounted panel whose adapter already forecasts, ready to spin up. */
async function mountReady(
  spinUp: (section: EstimateSection, setup: EstimateSection['setups'][number]) => Promise<void>,
) {
  const first = harness()
  const initial = fakeEstimate().inputs.request
  const mounted = render(
    <EstimatorPanel
      port={{ ...first.port, provision: { state: 'ready', spinUp } }}
      initial={initial}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateRun }))
  await screen.findByRole('heading', { name: UI_TEXT.estimateSchedule })
  return { first, initial, mounted }
}

async function refuseForecast() {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateRun }))
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toContain('estimate-unavailable')
  })
  expect(screen.queryByRole('heading', { name: UI_TEXT.estimateSchedule })).toBeNull()
}

describe('M117 Estimator panel', () => {
  it('preserves an explicit UTC deadline and accepts strict calendar dates without rollover', async () => {
    const h = harness()
    const initial = { ...fakeEstimate().inputs.request, deadline: '2026-10-08T04:00:00.000Z' }
    render(<EstimatorPanel port={h.port} initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateRun }))
    await screen.findByRole('heading', { name: UI_TEXT.estimateSchedule })
    expect(h.estimate.mock.calls[0]?.[0].deadline).toBe(initial.deadline)
    fireEvent.change(screen.getByLabelText(UI_TEXT.estimateDeadline), {
      target: { value: '2026-02-30' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateRefresh }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      UI_TEXT.estimateInvalidGoal,
    )
    expect(h.estimate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: UI_TEXT.estimateSchedule })).toBeNull()
    const oldView = fakeEstimate()
    oldView.asOf = '2026-10-06T12:30:00.000Z'
    oldView.inputs.request = { ...initial, asOf: oldView.asOf }
    oldView.inputs.fleet.asOf = oldView.asOf
    act(() => {
      h.emit(oldView)
    })
    expect(screen.queryByRole('heading', { name: UI_TEXT.estimateSchedule })).toBeNull()
    fireEvent.change(screen.getByLabelText(UI_TEXT.estimateDeadline), {
      target: { value: '2026-10-09' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateRun }))
    await screen.findByRole('heading', { name: UI_TEXT.estimateSchedule })
    expect(h.estimate.mock.calls[1]?.[0].deadline).toBe('2026-10-09T00:00:00.000Z')
  })

  it('shows forecasts, calibration and all inputs, with an honestly disabled Spin it up', async () => {
    const h = harness()
    await start(h.port)
    expect(screen.getByText(UI_TEXT.estimateCriticalBound)).toBeTruthy()
    expect(screen.getByText(/Uncalibrated prior/)).toBeTruthy()
    const spin = screen.getByRole('button', { name: UI_TEXT.estimateSpinUp })
    expect(spin.hasAttribute('disabled')).toBe(true)
    const reasonId = spin.getAttribute('aria-describedby')
    expect(screen.getByText(/M117-P-start/).id).toBe(reasonId)
    expect(screen.getByText(UI_TEXT.estimateInputs)).toBeTruthy()
    expect(screen.getByText(/"disks":/)).toBeTruthy()
    expect(screen.getByText(/"path": "\/p50"/)).toBeTruthy()
    expect(screen.getByText(/"reviewRoundRate":/)).toBeTruthy()
  })

  it('opens Gantt lane details using native focusable buttons and labels the setup radios', async () => {
    await start(harness().port)
    const section = fakeEstimate()
    const lane = section.schedule[0]
    if (!lane) throw new Error('missing fixture lane')
    const button = screen.getByRole('button', { name: new RegExp(lane.laneId) })
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe(
      button.closest('li')?.querySelector('div[id]')?.id,
    )
    expect(button.closest('li')?.querySelector('div[id]')?.hasAttribute('hidden')).toBe(false)
    const radio = screen.getByRole('radio', { name: /Current fleet/ })
    radio.focus()
    expect(document.activeElement).toBe(radio)
  })

  it('validates goals and refuses malformed or mismatched replies without showing a forecast', async () => {
    const h = harness()
    render(<EstimatorPanel port={h.port} />)
    fireEvent.change(screen.getByLabelText(UI_TEXT.estimateGoal), { target: { value: 'invalid' } })
    fireEvent.submit(screen.getByRole('button', { name: UI_TEXT.estimateRun }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      UI_TEXT.estimateInvalidGoal,
    )
    expect(h.estimate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(UI_TEXT.estimateGoal), { target: { value: 'M117' } })
    h.estimate.mockImplementationOnce(() => Promise.resolve({ ...fakeEstimate(), disclosures: [] }))
    await refuseForecast()
    h.estimate.mockImplementationOnce(() => {
      const section = fakeEstimate()
      section.inputs.request.fleet = 'optimum'
      return Promise.resolve(section)
    })
    await refuseForecast()
  })

  it('refuses an adapter that mutates the submitted request', async () => {
    const h = harness()
    h.estimate.mockImplementation((request) => {
      request.goal = { kind: 'milestone', milestoneId: 'M118' }
      const section = fakeEstimate()
      section.inputs.request = request
      return Promise.resolve(section)
    })
    render(<EstimatorPanel port={h.port} initial={fakeEstimate().inputs.request} />)
    await refuseForecast()
  })

  it('accepts newer matching refreshes and shows drift while ignoring stale or unrelated updates', async () => {
    const h = harness()
    await start(h.port)
    const next = fakeEstimate()
    next.asOf = '2026-10-06T12:30:00.000Z'
    next.inputs.request.asOf = next.asOf
    next.inputs.fleet.asOf = next.asOf
    next.drift = { previousAsOf: fakeEstimate().asOf, p50Hours: -1, p90Hours: 2 }
    next.disclosures.push(
      ...['p50Hours', 'p90Hours'].map((key) => ({
        path: `/drift/${key}`,
        basis: 'unknown' as const,
        samples: 0,
        uncertainty: { kind: 'unknown' as const },
      })),
    )
    act(() => {
      h.emit(next)
    })
    expect(screen.getByText(new RegExp(UI_TEXT.estimateDrift))).toBeTruthy()
    const other = structuredClone(next)
    other.asOf = '2026-10-06T12:40:00.000Z'
    other.inputs.request.asOf = other.asOf
    other.inputs.fleet.asOf = other.asOf
    other.inputs.request.goal = { kind: 'milestone', milestoneId: 'M118' }
    delete other.drift
    other.disclosures = other.disclosures.filter((row) => !row.path.startsWith('/drift/'))
    act(() => {
      h.emit(other)
    })
    act(() => {
      h.emit(fakeEstimate())
    })
    expect(screen.getByText(new RegExp(UI_TEXT.estimateDrift))).toBeTruthy()
    act(() => {
      h.emit({})
    })
    expect(screen.getByRole('alert').textContent).toBe(UI_TEXT.estimateDisclosureMissing)
  })

  it('selects the first available setup when the section has no current fleet', async () => {
    const h = harness()
    const startExisting = vi.fn(() => Promise.resolve())
    const base = fakeEstimate()
    const section: EstimateSection = {
      ...base,
      currentRefusal: 'unschedulable:M117:A',
      setups: [{ ...base.setups[0]!, kind: 'minimumP90', meetsDeadline: true }],
    }
    render(
      <EstimatorPanel
        port={{ ...h.port, startExisting }}
        initial={section.inputs.request}
        initialSection={section}
      />,
    )
    await screen.findByRole('heading', { name: UI_TEXT.estimateSchedule })
    const radio = screen.getByRole('radio', { name: new RegExp(UI_TEXT.estimateMinimum) })
    expect(radio).toHaveProperty('checked', true)
    expect(screen.queryByText(/M117-P-start/)).toBeNull()
    const spin = screen.getByRole('button', { name: UI_TEXT.estimateSpinUp })
    expect(spin.hasAttribute('disabled')).toBe(false)
    fireEvent.click(spin)
    await waitFor(() => {
      expect(startExisting).toHaveBeenCalledTimes(1)
    })
    expect(startExisting).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'estimate' }),
      expect.objectContaining({ kind: 'minimumP90' }),
    )
  })

  it('aborts in-flight work and unsubscribes when the panel closes', async () => {
    const pending = Promise.withResolvers<EstimateSection>()
    const h = harness()
    h.estimate.mockImplementation(() => pending.promise)
    const mounted = render(<EstimatorPanel port={h.port} initial={fakeEstimate().inputs.request} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateRun }))
    const signal = h.estimate.mock.calls[0]?.[1]
    mounted.unmount()
    expect(signal?.aborted).toBe(true)
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve(fakeEstimate())
      await pending.promise
    })
  })

  it('aborts a pending calculation when a newer refresh arrives and ignores its late reply', async () => {
    const pending = Promise.withResolvers<EstimateSection>()
    const h = harness()
    h.estimate.mockImplementation(() => pending.promise)
    render(<EstimatorPanel port={h.port} initial={fakeEstimate().inputs.request} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateRun }))
    const next = fakeEstimate()
    next.asOf = '2026-10-06T12:30:00.000Z'
    next.inputs.request.asOf = next.asOf
    next.inputs.fleet.asOf = next.asOf
    next.seed = 'newer-fixture'
    act(() => {
      h.emit(next)
    })
    expect(h.estimate.mock.calls[0]?.[1].aborted).toBe(true)
    expect(screen.getByText(/newer-fixture/)).toBeTruthy()
    await act(async () => {
      pending.resolve(fakeEstimate())
      await pending.promise
    })
    expect(screen.getByText(/newer-fixture/)).toBeTruthy()
  })

  it('keeps advice-only rentals disabled and hands an eligible setup to the injected P port', async () => {
    const h = harness()
    const spinUp = vi.fn(() => Promise.resolve())
    const readyPort: EstimatorPanelPort = { ...h.port, provision: { state: 'ready', spinUp } }
    await start(readyPort)
    const button = screen.getByRole('button', { name: UI_TEXT.estimateSpinUp })
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    await waitFor(() => {
      expect(spinUp).toHaveBeenCalledTimes(1)
    })
    expect(spinUp).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'estimate' }),
      expect.objectContaining({ kind: 'current' }),
    )
    cleanup()
    h.estimate.mockImplementationOnce((request) => {
      const section = fakeEstimate()
      section.inputs.request = request
      section.setups[0]!.provisioning = 'adviceOnly'
      return Promise.resolve(section)
    })
    await start(readyPort)
    expect(
      screen.getByRole('button', { name: UI_TEXT.estimateSpinUp }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getAllByText(UI_TEXT.estimateAdvice).length).toBeGreaterThan(0)
  })

  it('permits a new estimate after replacing an adapter with pending work', async () => {
    const first = harness()
    const gate = Promise.withResolvers<EstimateSection>()
    first.estimate.mockImplementation(() => gate.promise)
    const initial = fakeEstimate().inputs.request
    const mounted = render(<EstimatorPanel port={first.port} initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateRun }))
    expect(screen.getByRole('button', { name: UI_TEXT.estimateRun }).hasAttribute('disabled')).toBe(
      true,
    )
    const second = harness()
    mounted.rerender(<EstimatorPanel port={second.port} initial={initial} />)
    expect(first.estimate.mock.calls[0]?.[1].aborted).toBe(true)
    const run = screen.getByRole('button', { name: UI_TEXT.estimateRun })
    expect(run.hasAttribute('disabled')).toBe(false)
    fireEvent.click(run)
    await screen.findByRole('heading', { name: UI_TEXT.estimateSchedule })
    expect(second.estimate).toHaveBeenCalledTimes(1)
    await act(async () => {
      gate.resolve(fakeEstimate())
      await gate.promise
    })
    expect(run.hasAttribute('disabled')).toBe(false)
  })

  it('does not provision an old adapter forecast through a replacement adapter', async () => {
    const { initial, mounted } = await mountReady(vi.fn(() => Promise.resolve()))
    const second = harness()
    const secondSpin = vi.fn(() => Promise.resolve())
    const secondReady: EstimatorPanelPort = {
      ...second.port,
      provision: { state: 'ready', spinUp: secondSpin },
    }
    mounted.rerender(<EstimatorPanel port={secondReady} initial={initial} />)
    expect(screen.queryByRole('heading', { name: UI_TEXT.estimateSchedule })).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.estimateSpinUp })).toBeNull()
    expect(secondSpin).not.toHaveBeenCalled()
    const stale = fakeEstimate()
    act(() => {
      second.emit(stale)
    })
    expect(screen.queryByRole('heading', { name: UI_TEXT.estimateSchedule })).toBeNull()
    expect(secondSpin).not.toHaveBeenCalled()
  })

  it('ignores a late provisioning failure from a replaced adapter', async () => {
    const gate = Promise.withResolvers<undefined>()
    const { initial, mounted } = await mountReady(async () => {
      await gate.promise
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.estimateSpinUp }))
    const second = harness()
    mounted.rerender(<EstimatorPanel port={second.port} initial={initial} />)
    await act(async () => {
      gate.reject(new Error('old adapter failed'))
      try {
        await gate.promise
      } catch {
        // The replaced adapter's late failure must not surface on the new one.
      }
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
