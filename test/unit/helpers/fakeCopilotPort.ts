import type * as vscode from 'vscode'
import { vi } from 'vitest'
import type { CopilotPort } from '../../../src/host/providers/copilotClient'

/** Stable VS Code LM objects, entirely synthetic; selection sends no request. */
export function fakeCopilotPort() {
  let attempts = 0
  let isQuota = false
  const model: vscode.LanguageModelChat = {
    id: 'synthetic-copilot',
    name: 'Synthetic Copilot',
    vendor: 'copilot',
    family: 'synthetic',
    version: '1',
    maxInputTokens: 1000,
    countTokens: vi.fn(() => Promise.resolve(1)),
    sendRequest: vi.fn(() => {
      attempts += 1
      if (isQuota)
        return Promise.reject(
          Object.assign(new Error('private SDK detail'), { code: 'ChatQuotaExceeded' }),
        )
      return Promise.resolve({
        stream: (async function* () {
          await Promise.resolve()
          if (attempts === 1)
            yield { callId: 'synthetic-call', name: 'read_file', input: { path: 'example.txt' } }
          else yield { value: 'Read the example.' }
        })(),
        text: (async function* () {
          await Promise.resolve()
          yield 'Read the example.'
        })(),
      })
    }),
  }
  const api: CopilotPort = {
    selectChatModels: vi.fn(() => Promise.resolve([model])),
    user: (value) => ({ role: 1, content: value === '' ? [] : [{ value }], name: undefined }),
    assistant: (value) => ({ role: 2, content: value === '' ? [] : [{ value }], name: undefined }),
    text: (value) => ({ value }),
    call: (callId, name, input) => ({ callId, name, input }),
    result: (callId, content) => ({ callId, content }),
    isText: (part): part is vscode.LanguageModelTextPart =>
      typeof part === 'object' &&
      part !== null &&
      'value' in part &&
      typeof part.value === 'string',
    isCall: (part): part is vscode.LanguageModelToolCallPart =>
      typeof part === 'object' &&
      part !== null &&
      'callId' in part &&
      'name' in part &&
      'input' in part,
    cancellation: () => ({
      token: {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: vi.fn() }),
      },
      cancel: vi.fn(),
      dispose: vi.fn(),
    }),
  }
  return {
    model,
    api,
    quota: () => {
      isQuota = true
    },
  }
}
