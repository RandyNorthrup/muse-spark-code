import { describe, expect, it } from 'vitest'
import {
  isStrictToolLimitErrorMessage,
  withStrictTools,
  withoutStrictTools,
} from '../../src/core/backends/modelapi/schemas'
import { toolDefinitions } from '../../src/core/backends/modelapi/tools'

// Strict-limit fallback (Pi #11416): the refusal detector and the
// preferred-strict to non-strict restoration, over the product's own
// tool declarations through the real strict conversion.
describe('strict tool limit fallback', () => {
  it.each([
    'The compiled grammar is too large',
    'Too many strict tools (21, limit 20)',
    'Schemas contains too many parameters with union types (20, limit 16)',
  ])('detects the refusal: %s', (message) => {
    expect(isStrictToolLimitErrorMessage(`Validation error: ${message}`)).toBe(true)
  })

  it.each([
    'prompt is too long: 9000 tokens > 8192 maximum',
    'Too many strict tools configured', // Pi matches the parenthesised limit only.
    'invalid_request_error',
  ])('ignores other failures: %s', (message) => {
    expect(isStrictToolLimitErrorMessage(message)).toBe(false)
  })

  it('restores strict tools to the declarations the session built', () => {
    const declared = toolDefinitions('linux')
    const strict = withStrictTools(declared, true)
    const converted = strict.filter((tool) => tool.strict)
    expect(converted.length).toBeGreaterThan(0)
    const restored = withoutStrictTools(strict)
    expect(restored).toHaveLength(declared.length)
    for (const [index, original] of declared.entries()) {
      const back = restored[index]
      expect(back?.type).toBe(original.type)
      expect(back?.strict).toBe(false)
      expect(back?.parameters).toEqual(original.parameters)
      expect(
        back === undefined ? undefined : Object.getOwnPropertyDescriptor(back, 'previewFields'),
      ).toEqual(Object.getOwnPropertyDescriptor(original, 'previewFields'))
    }
  })

  it('passes tools that never went strict through untouched', () => {
    const declared = toolDefinitions('linux')
    const restored = withoutStrictTools(declared)
    for (const [index, original] of declared.entries()) {
      expect(restored[index]).toBe(original)
    }
  })
})
