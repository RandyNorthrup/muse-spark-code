// M95b acceptance 10: every hook event fires with the provider id and
// the qualified model. Turn-bound extension events run in the session's
// turn loop on every model, plan turns included; the envelope must name
// the turn's own provider, never a fixed one. These run the real
// payload builder with the contexts the session and the host runner
// pass it.
import { describe, expect, it } from 'vitest'
import {
  extensionHookPayload,
  type ExtensionHookContext,
} from '../../src/core/backends/modelapi/extensionHooks'
import { replayProducer } from '../../src/core/backends/modelapi/modelPolicy'

const base = (context: Partial<ExtensionHookContext>) =>
  extensionHookPayload('PreModelSwitch', {
    sessionId: 'session-1',
    workspaceRoot: '/workspace',
    ...context,
  })

describe('extension hook envelope model', () => {
  it('names the ChatGPT plan provider with the qualified model', () => {
    const modelId = 'chatgpt/gpt-6.1-sol'
    const payload = base({ modelId, providerId: replayProducer(modelId).provider })
    expect(payload['model']).toBe('chatgpt/gpt-6.1-sol')
    expect(payload['model_provider']).toBe('chatgpt')
  })

  it('names the Copilot plan provider with the qualified model', () => {
    const modelId = 'copilot/gpt-4o'
    const payload = base({ modelId, providerId: replayProducer(modelId).provider })
    expect(payload['model']).toBe('copilot/gpt-4o')
    expect(payload['model_provider']).toBe('copilot')
  })

  it('keeps a bare model on Meta, the same rule as the sibling payload', () => {
    const modelId = 'muse-spark-1.3'
    const payload = base({ modelId, providerId: replayProducer(modelId).provider })
    expect(payload['model']).toBe('muse-spark-1.3')
    expect(payload['model_provider']).toBe('meta')
  })

  it('carries no model keys where the host runner passes no model', () => {
    const payload = base({})
    expect('model' in payload).toBe(false)
    expect('model_provider' in payload).toBe(false)
  })

  it('carries neither key when the provider is missing, never a fixed one', () => {
    const payload = base({ modelId: 'chatgpt/gpt-6.1-sol' })
    expect('model' in payload).toBe(false)
    expect('model_provider' in payload).toBe(false)
  })
})
