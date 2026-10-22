// A timed-out MCP elicitation settles as cancel, never as accept, and the
// person is told with the server that asked: the notice names the server,
// the waited seconds, and that no answer was sent. Through the real fill
// and the real installed sentence, with the values the timer passes.
import { describe, expect, it } from 'vitest'
import { MCP_ELICITATION_TIMEOUT_MS } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

describe('the elicitation timeout notice', () => {
  it('names the server, the waited seconds and the cancelled answer', () => {
    const notice = fill(UI_TEXT.mcpElicitationTimedOut, {
      server: 'printer',
      seconds: Math.round(MCP_ELICITATION_TIMEOUT_MS / 1000),
    })
    expect(notice).toContain('printer')
    expect(notice).toContain('300 seconds')
    expect(notice).toContain('settled as cancelled')
    expect(notice).toContain('No answer was sent')
  })
})
