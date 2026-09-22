import { describe, expect, it } from 'vitest'
import { createLogger } from '../../src/host/logger'
import { FakeLogOutputChannel } from './helpers/fakes'

describe('createLogger', () => {
  it.each(['info', 'warn', 'error'] as const)('redacts secrets before %s', (level) => {
    const channel = new FakeLogOutputChannel()
    createLogger(channel)[level]('spawning with META_API_KEY=LLM|42|topsecret')
    expect(channel[level]).toHaveBeenCalledWith('spawning with META_API_KEY=[redacted]')
  })
})
