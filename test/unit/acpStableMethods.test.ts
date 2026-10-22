import { RequestError } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import { hasBooleanOptions, parseAdditionalDirectories } from '../../src/acp/agent'
import { UpdateTranslator } from '../../src/acp/translate'

// ACPGAPS: the stabilized editor-protocol surface, through the real modules
// with values passed in as data. Every assertion is a whole request or
// update body, never a fragment.

const CWD = '/work/app'

describe('hasBooleanOptions', () => {
  it('needs the client to advertise the boolean capability', () => {
    expect(hasBooleanOptions(undefined)).toBe(false)
    expect(hasBooleanOptions({})).toBe(false)
    expect(hasBooleanOptions({ session: null })).toBe(false)
    expect(hasBooleanOptions({ session: { configOptions: null } })).toBe(false)
    expect(hasBooleanOptions({ session: { configOptions: {} } })).toBe(false)
    expect(hasBooleanOptions({ session: { configOptions: { boolean: null } } })).toBe(false)
    expect(hasBooleanOptions({ session: { configOptions: { boolean: {} } } })).toBe(true)
  })
})

describe('parseAdditionalDirectories', () => {
  it('keeps absolute roots as sent and defaults to none', () => {
    expect(parseAdditionalDirectories(undefined)).toEqual([])
    expect(parseAdditionalDirectories([])).toEqual([])
    expect(parseAdditionalDirectories(['/a', '/b/c'])).toEqual(['/a', '/b/c'])
    expect(parseAdditionalDirectories([String.raw`C:\work\lib`])).toEqual([String.raw`C:\work\lib`])
  })

  it('refuses anything that is not absolute roots', () => {
    for (const value of ['/a', 'relative', ['relative'], ['/ok', 7], { length: 0 }, null]) {
      expect(() => parseAdditionalDirectories(value)).toThrow(RequestError)
    }
  })
})

describe('message ids on chunks', () => {
  it('names every chunk of an item with the item, and a new item starts a new message', () => {
    const translator = new UpdateTranslator(CWD, false)
    translator.updates({
      type: 'itemStarted',
      item: { itemId: 'm1', kind: 'agentMessage', status: 'inProgress' },
    })
    expect(
      translator.updates({ type: 'textDelta', itemId: 'm1', field: 'text', delta: 'Hello' }),
    ).toEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello' },
        messageId: 'm1',
      },
    ])
    translator.updates({
      type: 'itemStarted',
      item: { itemId: 'm2', kind: 'agentMessage', status: 'inProgress' },
    })
    expect(
      translator.updates({ type: 'textDelta', itemId: 'm2', field: 'text', delta: 'Again' }),
    ).toEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Again' },
        messageId: 'm2',
      },
    ])
  })

  it('names a replayed user message with its item too', () => {
    expect(
      new UpdateTranslator(CWD, true).itemUpdates(
        { itemId: 'u1', kind: 'userMessage', status: 'completed', text: 'Hi' },
        true,
      ),
    ).toEqual([
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Hi' },
        messageId: 'u1',
      },
    ])
  })
})
