import { describe, expect, it, vi } from 'vitest'
import { fakeEstimate } from './helpers/estimator/fixtures'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'

describe('first-use estimator contracts', () => {
  it('refuses use before loading and validates the complete contract after loading', async () => {
    vi.resetModules()
    const section = fakeEstimate()
    const frame = { type: 'estimatorSection', section }
    expect(parseHostToWebviewMessage(frame).ok).toBe(false)
    const lazy = await import('../../src/shared/estimatorProtocol')
    expect(lazy.parseHostToEstimatorMessage(frame)).toEqual({ ok: true, message: frame })
    const request = { type: 'estimateRun', request: section.inputs.request }
    expect(lazy.parseEstimatorToHostMessage(request)).toEqual({ ok: true, message: request })
    expect(
      lazy.parseHostToEstimatorMessage({ ...frame, section: { ...section, disclosures: [] } }).ok,
    ).toBe(false)
    expect(
      lazy.parseEstimatorToHostMessage({
        ...request,
        request: { ...request.request, goal: { kind: 'issues', numbers: [1, 1] } },
      }).ok,
    ).toBe(false)
  })
})
