// C7: an elicitation form that waits out its deadline settles as cancel,
// never as accept, and the person is told. The deadline abort carries its
// own reason so a timeout is told apart from a stop. Real AbortSignals and
// the real template, values passed in as data.
import { describe, expect, it } from 'vitest'
import {
  isElicitationTimeout,
  McpElicitationTimeoutError,
} from '../../src/core/backends/modelapi/mcp/connection'
import { MCP_ELICITATION_TIMEOUT_MS, UI_TEXT } from '../../src/shared/constants'
import { fill, formatNumber } from '../../src/shared/l10n/text'

describe('isElicitationTimeout', () => {
  it('recognises the deadline abort', () => {
    const controller = new AbortController()
    controller.abort(new McpElicitationTimeoutError())
    expect(isElicitationTimeout(controller.signal)).toBe(true)
  })

  it('does not mistake a bare stop for a timeout', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isElicitationTimeout(controller.signal)).toBe(false)
  })

  it('does not mistake a live wait for a timeout', () => {
    const controller = new AbortController()
    expect(isElicitationTimeout(controller.signal)).toBe(false)
  })

  it('does not mistake another error reason for a timeout', () => {
    const controller = new AbortController()
    controller.abort(new Error('the user stopped the turn'))
    expect(isElicitationTimeout(controller.signal)).toBe(false)
  })
})

describe('elicitation timeout notice', () => {
  it('names the server, the wait and the cancelled settlement', () => {
    const seconds = Math.round(MCP_ELICITATION_TIMEOUT_MS / 1000)
    const notice = fill(UI_TEXT.mcpElicitationTimedOut, { server: 'printer', seconds })
    expect(notice).toContain('printer')
    expect(notice).toContain(formatNumber(seconds))
    expect(notice).toContain('cancelled')
  })
})
