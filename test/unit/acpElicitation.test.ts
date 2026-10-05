// The ACP agent's elicitation form mapping (M91 lane M): validated MCP
// fields into the client's form vocabulary, and the client's answer back.

import { describe, expect, it } from 'vitest'
import { elicitationSchema, elicitationText, parseElicitationResult } from '../../src/acp/questions'
import type { ElicitationField } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'

const NAME: ElicitationField = { name: 'name', title: 'Name', type: 'string', required: true }

describe('the ACP elicitation form (M91 lane M)', () => {
  it('carries titles, enums, formats, defaults and required names', () => {
    expect(
      elicitationSchema([
        NAME,
        { name: 'colour', type: 'string', required: false, enum: ['red', 'blue'] },
        { name: 'email', type: 'string', required: false, format: 'email' },
        { name: 'age', type: 'integer', required: true, default: 3 },
        { name: 'robot', type: 'boolean', required: false, default: true },
      ]),
    ).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name' },
        colour: { type: 'string', enum: ['red', 'blue'] },
        email: { type: 'string', format: 'email' },
        age: { type: 'integer', default: 3 },
        robot: { type: 'boolean', default: true },
      },
      required: ['name', 'age'],
    })
  })

  it('retains bounds and enum labels in the client form', () => {
    const schema = elicitationSchema([
      { name: 'count', type: 'number', required: true, minimum: 1, maximum: 2 },
      { name: 'at', type: 'string', required: false, minLength: 1, maxLength: 2 },
      { name: 'flag', type: 'string', required: false, enum: ['y'], enumNames: ['Yes'] },
    ])
    expect(schema.properties).toEqual({
      count: { type: 'number', minimum: 1, maximum: 2 },
      at: { type: 'string', minLength: 1, maxLength: 2 },
      flag: { type: 'string', oneOf: [{ const: 'y', title: 'Yes' }] },
    })
  })

  it('reads accept, decline, cancel, and nothing else', () => {
    expect(parseElicitationResult({ action: 'accept', content: { name: 'Ada' } })).toEqual({
      action: 'accept',
      content: { name: 'Ada' },
    })
    expect(parseElicitationResult({ action: 'accept' })).toEqual({
      action: 'accept',
      content: undefined,
    })
    expect(parseElicitationResult({ action: 'decline' })).toEqual({ action: 'decline' })
    expect(parseElicitationResult({ action: 'cancel' })).toEqual({ action: 'cancel' })
    expect(parseElicitationResult({ action: 'maybe' })).toBeUndefined()
    expect(parseElicitationResult(undefined)).toBeUndefined()
  })

  it('texts the message with its fields where there are no forms', () => {
    expect(elicitationText('Who goes there?', [NAME])).toBe(
      `${UI_TEXT.acpQuestionAsked}\nWho goes there?\n- Name`,
    )
  })
})
