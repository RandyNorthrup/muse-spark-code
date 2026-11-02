import { describe, expect, it } from 'vitest'
import type { ModelSummary } from '../../src/core/agent/agentBackend'
import { toModelOption } from '../../src/host/conversation/conversationController'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'

// The controller's row mapping carries the registry's lifecycle honesty
// to the picker wire (PROV-HONEST): retirement, beta and the serving
// model survive the webview's zod validation, and an active row without
// any mark stays silent.
describe('model option lifecycle honesty', () => {
  it('carries lifecycle, retirement, beta and reroute to the wire', () => {
    const summaries: ModelSummary[] = [
      {
        modelId: 'openai/gpt-4o-2024-08-06',
        displayLabel: 'GPT-4o',
        contextLimit: 128_000,
        isDefault: false,
        lifecycle: 'deprecated',
        retiresAt: '2027-01-14',
      },
      {
        modelId: 'mistral/mistral-large-4',
        displayLabel: 'Mistral Large 4',
        contextLimit: 128_000,
        isDefault: false,
        beta: true,
      },
      {
        modelId: 'gemini/gemini-3.5-flash',
        displayLabel: 'Gemini 3.6 Flash',
        contextLimit: 1_048_576,
        isDefault: false,
        reroute: {
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
        reroute: {
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
      },
    ]
    const options = summaries.map((summary) => toModelOption(summary))
    const wire = parseHostToWebviewMessage({ type: 'modelList', models: options })
    if (!wire.ok) throw new Error(`Dropped model list: ${wire.error}`)
    const byId = (id: string) => options.find((option) => option.modelId === id)
    expect(byId('openai/gpt-4o-2024-08-06')).toMatchObject({
      lifecycle: 'deprecated',
      retiresAt: '2027-01-14',
    })
    expect(byId('mistral/mistral-large-4')).toMatchObject({ beta: true })
    expect(byId('gemini/gemini-3.5-flash')).toMatchObject({
      reroute: { serves: 'gemini-3.6-flash', servesLabel: 'Gemini 3.6 Flash', active: true },
    })
    expect(byId('gemini/gemini-2.5-pro')).toMatchObject({
      reroute: {
        serves: 'gemini-3.8-flash',
        servesLabel: 'Gemini 3.8 Flash',
        active: false,
        from: '2026-12-01',
      },
    })
    const silent = byId('openai/gpt-5.6-luna')
    expect(silent?.lifecycle).toBeUndefined()
    expect(silent?.retiresAt).toBeUndefined()
    expect(silent?.beta).toBeUndefined()
    expect(silent?.reroute).toBeUndefined()
  })
})
