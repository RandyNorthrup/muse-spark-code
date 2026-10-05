// The M95 lane-U wire guards (PLAN.md D74, acceptance 19): `byo` joins the
// sign-in methods, model options carry provider fields, the wizard's finish
// and per-provider usage cross the bridge, and the picker's rows reach the
// host. Each guard is broken once on purpose (docs/certification/m95-u.md).

import { describe, expect, it } from 'vitest'
import {
  parseHostToWebviewMessage,
  parseWebviewToHostMessage,
  SIGN_IN_METHODS,
} from '../../src/shared/protocol'

describe('M95 first-run wire', () => {
  it('offers byo beside the two existing sign-in methods', () => {
    expect(SIGN_IN_METHODS).toEqual(['browser', 'apiKey', 'byo'])
    expect(parseWebviewToHostMessage({ type: 'signIn', method: 'byo' })).toEqual({
      ok: true,
      message: { type: 'signIn', method: 'byo' },
    })
  })

  it('refuses an unknown sign-in method', () => {
    const result = parseWebviewToHostMessage({ type: 'signIn', method: 'oauth' })
    expect(result.ok).toBe(false)
  })

  it('routes the first-run and picker rows as host actions', () => {
    for (const action of ['startWithOwnModel', 'addModelProvider', 'manageModels'] as const) {
      expect(parseWebviewToHostMessage({ type: 'hostAction', action })).toEqual({
        ok: true,
        message: { type: 'hostAction', action },
      })
    }
  })

  it('carries the wizard finish across the bridge', () => {
    const message = {
      type: 'setupComplete',
      provider: 'OpenRouter',
      model: 'openrouter/deepseek/deepseek-v3',
    }
    expect(parseHostToWebviewMessage(message)).toEqual({ ok: true, message })
  })

  it('carries per-provider usage across the bridge', () => {
    const message = {
      type: 'usageReport',
      backend: 'modelApi',
      providers: [
        {
          providerId: 'openrouter',
          providerLabel: 'OpenRouter',
          pricing: 'priced',
          inputTokens: 1200,
          outputTokens: 300,
          costUsd: 0.001,
          keyUsage: { todayUsd: 0.4, monthUsd: 2.1, limitUsd: 10, remainingUsd: 7.9 },
        },
        {
          providerId: 'ollama',
          providerLabel: 'Ollama',
          pricing: 'local',
          inputTokens: 800,
          outputTokens: 100,
        },
      ],
    }
    expect(parseHostToWebviewMessage(message)).toEqual({ ok: true, message })
  })

  it('refuses a provider row without its price kind', () => {
    const result = parseHostToWebviewMessage({
      type: 'usageReport',
      backend: 'modelApi',
      providers: [
        {
          providerId: 'openrouter',
          providerLabel: 'OpenRouter',
          inputTokens: 1,
          outputTokens: 1,
        },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('carries provider fields on model options', () => {
    const models = [
      { modelId: 'muse-spark-1.3', displayLabel: 'muse-spark-1.3', isDefault: false },
      {
        modelId: 'openrouter/deepseek/deepseek-v3',
        displayLabel: 'DeepSeek V3',
        contextLimit: 64000,
        isDefault: true,
        providerId: 'openrouter',
        providerLabel: 'OpenRouter',
        pricing: 'priced',
        inputUsdPerMTokens: 0.27,
        outputUsdPerMTokens: 1.1,
        isPinned: true,
      },
      {
        modelId: 'openrouter/any/model',
        displayLabel: 'Any',
        isDefault: false,
        providerId: 'openrouter',
        pricing: 'unpriced',
        trainsOnContent: true,
      },
    ]
    expect(parseHostToWebviewMessage({ type: 'modelList', models })).toEqual({
      ok: true,
      message: { type: 'modelList', models },
    })
  })

  it('refuses an unknown price kind on a model option', () => {
    const result = parseHostToWebviewMessage({
      type: 'modelList',
      models: [{ modelId: 'x/y', displayLabel: 'y', isDefault: false, pricing: 'free' }],
    })
    expect(result.ok).toBe(false)
  })

  it('offers byo in the gate state', () => {
    const message = {
      type: 'authState',
      status: 'signedOut',
      methods: ['browser', 'apiKey', 'byo'],
    }
    expect(parseHostToWebviewMessage(message)).toEqual({ ok: true, message })
  })
})
