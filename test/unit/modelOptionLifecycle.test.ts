import { describe, expect, it } from 'vitest'
import type { ModelSummary } from '../../src/core/agent/agentBackend'
import { toModelOption } from '../../src/host/conversation/conversationController'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'

// The controller's row mapping composes the registry's lifecycle honesty
// into picker-wire marks (PROV-HONEST): retirement, beta and the serving
// model survive the webview's zod validation, and an active row without
// any mark stays silent.
describe('model option lifecycle honesty', () => {
  it('composes lifecycle, retirement, beta and reroute into wire marks', () => {
    const summaries: ModelSummary[] = [
      {
        modelId: 'openai/gpt-4o-2024-08-06',
        displayLabel: 'GPT-4o',
        contextLimit: 128_000,
        isDefault: false,
        isActive: true,
        lifecycle: 'deprecated',
        retiresAt: '2027-01-14',
      },
      {
        modelId: 'mistral/mistral-large-4',
        displayLabel: 'Mistral Large 4',
        contextLimit: 128_000,
        isDefault: false,
        isActive: true,
        beta: true,
      },
      {
        modelId: 'gemini/gemini-3.5-flash',
        displayLabel: 'Gemini 3.6 Flash',
        contextLimit: 1_048_576,
        isDefault: false,
        isActive: true,
        reroute: {
          requested: 'gemini-3.5-flash',
          serves: 'gemini-3.6-flash',
          servesLabel: 'Gemini 3.6 Flash',
          active: true,
        },
      },
      {
        modelId: 'gemini/gemini-2.5-pro',
        displayLabel: 'Gemini 2.5 Pro',
        contextLimit: 1_048_576,
        isDefault: false,
        isActive: true,
        reroute: {
          requested: 'gemini-2.5-pro',
          serves: 'gemini-3.8-flash',
          servesLabel: 'Gemini 3.8 Flash',
          active: false,
          from: '2026-12-01',
        },
      },
      {
        modelId: 'openai/gpt-5.6-luna',
        displayLabel: 'GPT-5.6 Luna',
        contextLimit: 400_000,
        isDefault: true,
        isActive: true,
      },
    ]
    const options = summaries.map((summary) => toModelOption(summary))
    const wire = parseHostToWebviewMessage({ type: 'modelList', models: options })
    if (!wire.ok) throw new Error(`Dropped model list: ${wire.error}`)
    const byId = (id: string) => options.find((option) => option.modelId === id)
    expect(byId('openai/gpt-4o-2024-08-06')).toMatchObject({ marks: ['Retires Jan 14, 2027'] })
    expect(byId('mistral/mistral-large-4')).toMatchObject({ marks: ['Beta'] })
    expect(byId('gemini/gemini-3.5-flash')).toMatchObject({
      marks: ['Serves gemini-3.5-flash requests'],
    })
    expect(byId('gemini/gemini-2.5-pro')).toMatchObject({
      marks: ['Routes to Gemini 3.8 Flash on Dec 1, 2026'],
    })
    expect(byId('openai/gpt-5.6-luna')?.marks).toBeUndefined()
  })
})
