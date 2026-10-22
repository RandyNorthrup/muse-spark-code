// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ModelSummary } from '../../src/core/agent/agentBackend'
import { NATIVE_MODEL_EFFORTS } from '../../src/core/backends/musecode/modelEfforts'
import { toModelOption } from '../../src/host/conversation/conversationController'
import { isEffortLevel, servedEffortLevels } from '../../src/shared/effort'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'
import { catalogueSliderProps, EffortSlider } from '../../src/webview/components/EffortSlider'

// RVCM1063 #3: the captured effort variants and the catalogue default reach
// the production sliders through the served rows the controller admits. One
// test walks the whole path — the captured `model/list` frame, the real
// native reader, the controller's row mapping, the webview's wire
// validation, and the rendered tiers — so dropping a field at any step fails
// it. Live host dispatch needs a `muse serve` connection, so it is proven by
// the real-life run in docs/certification/msm106.md, not here.
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
  it('carries the contributor variants, description and default to the pressed dot', () => {
    const rows = capturedCatalogue().models.map((row) => ({
      modelId: row['modelId'] as string,
      ...NATIVE_MODEL_EFFORTS.parseModel(row),
    }))
    // The admission every surface shares: dots, keyboard stepping, palette
    // and ACP all read these tiers, never the static family table.
    expect(servedEffortLevels(rows, 'muse-spark-1.3-contributor')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    const captured = capturedCatalogue().models.find(
      (row) => row['modelId'] === 'muse-spark-1.3-contributor',
    )
    const summary: ModelSummary = {
      modelId: 'muse-spark-1.3-contributor',
      displayLabel: captured?.['displayLabel'] as string,
      contextLimit: captured?.['contextLimit'] as number,
      isDefault: captured?.['isDefault'] as boolean,
      isActive: captured?.['isActive'] as boolean,
      ...NATIVE_MODEL_EFFORTS.parseModel(captured),
    }
    const options = [summary].map((item) => toModelOption(item))
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
    const selected: string[] = []
    const onSelect = (tier: string): void => {
      selected.push(tier)
    }
    render(
      <EffortSlider
        levels={servedEffortLevels(rows, 'muse-spark-1.3-contributor')}
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
    expect(selected).toEqual(['minimal'])
  })
})
