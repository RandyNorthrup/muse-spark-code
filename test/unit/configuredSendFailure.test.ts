import { describe, expect, it } from 'vitest'
import { providerSendFailure } from '../../src/core/providers/configured'

// Lane TURNLIMIT, F88: a send that never got a response says its real cause
// (the network error's code), never the panel's unavailable text and never
// the error's free text. Pure: the real helper, values passed in as data.
describe('providerSendFailure', () => {
  it('names the network error’s code and says the send was not retried', () => {
    const error = providerSendFailure({
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:431',
    })
    expect(error.status).toBe(0)
    expect(error.message).toContain('ECONNREFUSED')
    expect(error.message).toContain('not sent again')
    expect(error.message).not.toContain('Models & Agents')
    expect(error.message).not.toContain('127.0.0.1')
  })

  it('replaces a non-word code with a fixed phrase, echoing no secret', () => {
    const error = providerSendFailure({ code: 'leaked sk-ant-123 "quoted"' })
    expect(error.message).not.toContain('sk-ant-123')
    expect(error.message).toContain('an unrecognized value')
  })

  it('says unknown when the failure carries no code', () => {
    const error = providerSendFailure(new Error('socket hang up'))
    expect(error.message).toContain('unknown')
    expect(error.message).not.toContain('socket hang up')
  })
})
