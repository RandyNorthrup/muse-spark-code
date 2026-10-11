// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NATIVE_MODEL_EFFORTS } from '../../src/core/backends/musecode/modelEfforts'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { toModelOption } from '../../src/host/conversation/conversationController'
import { catalogueSliderProps, effortLevelsFor, isEffortLevel } from '../../src/shared/effort'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'
import { EffortSlider } from '../../src/webview/components/EffortSlider'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeInitializeResult, fakeMspHost } from './helpers/fakeMsp'

// RVCM1063 #3: the captured effort variants and the catalogue default reach
// the production sliders through the model list the controller sends. One
// test walks the whole path — the captured `model/list` frame, the bound
// host, the controller's row mapping, the webview's wire validation, and the
// rendered tiers — so dropping a field at any step fails it.
const fixture = JSON.parse(
  readFileSync(path.resolve('test/fixtures/m106/msp-1.4.4-host-feedback.json'), 'utf8'),
) as {
  frames: {
    direction: string
    frame: { id?: number; result?: unknown }
  }[]
}

function capturedCatalogue(): { models: Record<string, unknown>[] } {
  const frame = fixture.frames.find(
    (row) => row.direction === 'received' && row.frame.id === 2,
  )?.frame
  if (!frame) throw new Error('Missing captured model/list')
  return frame.result as { models: Record<string, unknown>[] }
}

describe('Effort catalogue: captured frame to rendered tiers', () => {
  it('carries the contributor variants, description and default to the pressed dot', async () => {
    const served = fakeMspHost({ ...fakeInitializeResult, grantedCapabilities: [] })
    const host = new MuseCodeHost(
      served.host,
      new FakeLogOutputChannel(),
      { normalMs: 100, longMs: 100 },
      { modelEfforts: NATIVE_MODEL_EFFORTS },
    )
    served.server.handle('model/list', () => capturedCatalogue())
    const summaries = await host.listModels()
    const options = summaries.map((summary) => toModelOption(summary))
    // The controller's post survives the webview's zod validation,
    // including a later tier the enum field would reject.
    const wire = parseHostToWebviewMessage({
      type: 'modelList',
      models: [
        ...options,
        {
          modelId: 'muse-spark-2.0',
          displayLabel: 'Future',
          isDefault: false,
          variants: ['minimal', 'turbo'],
          defaultReasoningEffort: 'turbo',
        },
      ],
    })
    if (!wire.ok) throw new Error(`Dropped model list: ${wire.error}`)
    const contributor = options.find((model) => model.modelId === 'muse-spark-1.3-contributor')
    expect(contributor).toMatchObject({
      variants: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      reasoningEffortVariants: [{ tier: 'xhigh', description: expect.any(String) }],
      defaultReasoningEffort: 'max',
    })
    // The panel footer's wiring, as App builds it: the pressed dot is the
    // running effort, named by the catalogue.
    const onSelect = vi.fn()
    render(
      <EffortSlider
        levels={effortLevelsFor('muse-spark-1.3-contributor')}
        current="max"
        onSelect={onSelect}
        model={catalogueSliderProps(contributor, 'max', (tier) => {
          if (isEffortLevel(tier)) onSelect(tier)
        })}
      />,
    )
    const dots = screen.getAllByRole('button')
    expect(dots.map((dot) => dot.getAttribute('title'))).toEqual([
      'Minimal',
      'Low',
      'Medium',
      'High',
      'Use this for deepest analysis and complex fixes.',
      'Max',
    ])
    expect(dots.filter((dot) => dot.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(dots[5]).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(dots[0]!)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('minimal')
  })
})
