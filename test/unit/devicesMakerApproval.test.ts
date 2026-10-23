// RLF-DEVICES: the maker exact-payload prompt rides the Devices panel
// state (over either enabled state while pending) and the document
// answers it with the request id and payload digest echoed. Malformed
// prompts and answers never parse.
import { describe, expect, it } from 'vitest'
import {
  makerApprovalAnswerSchema,
  makerApprovalPromptSchema,
  type MakerApprovalPrompt,
} from '../../src/shared/maker'
import { parseDeviceHostMessage, parseDeviceWebviewRequest } from '../../src/shared/devicesPanel'

const REQUEST_ID = 'a'.repeat(32)
const DIGEST = 'b'.repeat(64)

function prompt(): MakerApprovalPrompt {
  return makerApprovalPromptSchema.parse({
    requestId: REQUEST_ID,
    digest: DIGEST,
    target: {
      kind: 'printer',
      name: 'Ender (simulator)',
      endpoint: 'sim://printer/0',
      reportedAs: 'virtual-marlin 1.0',
      simulated: true,
    },
    operation: 'actuate',
    preview: [{ kind: 'text', text: 'G1 X10 Y10 F1500' }],
    analysis: {
      bounds: { min: {}, max: { x: 10, y: 10 } },
      maxFeedMmMin: 1500,
      unknownCommands: [],
    },
  })
}

function parseAnswer(decision: string, digest: string) {
  return parseDeviceWebviewRequest({
    type: 'deviceRequest',
    viewId: 'c'.repeat(32),
    requestId: 'd'.repeat(32),
    revision: 4,
    action: {
      kind: 'answerMakerApproval',
      requestId: REQUEST_ID,
      decision,
      digest,
    },
  })
}

describe('maker approval protocol', () => {
  it('carries a prompt over the off state', () => {
    const parsed = parseDeviceHostMessage({
      type: 'deviceState',
      revision: 3,
      state: { enabled: false, makerApproval: prompt() },
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const state = parsed.message.state
    expect(state).toMatchObject({ enabled: false })
    if (state.enabled) return
    expect(state.makerApproval?.requestId).toBe(REQUEST_ID)
  })

  it('carries a prompt over the on state', () => {
    const parsed = parseDeviceHostMessage({
      type: 'deviceState',
      revision: 4,
      state: { enabled: true, discoveryEnabled: false, devices: [], makerApproval: prompt() },
    })
    expect(parsed.ok).toBe(true)
  })

  it('parses the echoed answer', () => {
    const answer = makerApprovalAnswerSchema.parse({
      requestId: REQUEST_ID,
      decision: 'send',
      digest: DIGEST,
    })
    const parsed = parseDeviceWebviewRequest({
      type: 'deviceRequest',
      viewId: 'c'.repeat(32),
      requestId: 'd'.repeat(32),
      revision: 4,
      action: { kind: 'answerMakerApproval', ...answer },
    })
    expect(parsed.ok).toBe(true)
  })

  it('refuses a prompt with a malformed digest', () => {
    const parsed = parseDeviceHostMessage({
      type: 'deviceState',
      revision: 5,
      state: {
        enabled: false,
        makerApproval: { ...prompt(), digest: 'not-a-digest' },
      },
    })
    expect(parsed.ok).toBe(false)
  })

  it('refuses an answer with a malformed echo', () => {
    const parsed = parseAnswer('send', 'e'.repeat(63))
    expect(parsed.ok).toBe(false)
  })

  it('refuses an answer with an unknown decision', () => {
    const parsed = parseAnswer('always', DIGEST)
    expect(parsed.ok).toBe(false)
  })
})
