// M91 lane W: the contract engine's dotted paths never reach a prototype
// (semgrep javascript prototype-pollution-loop at engine.ts). A path segment
// named __proto__, constructor or prototype reads nothing and writes nothing,
// and an inherited key reads as absent. Fake-only: no hook runs.
import { afterEach, describe, expect, it } from 'vitest'
import type { VendorContract } from '../../src/core/backends/modelapi/hookFormats/contract'
import {
  buildStdin,
  isSafePath,
  pathValue,
  setPath,
} from '../../src/core/backends/modelapi/hookFormats/engine'

function contractWriting(to: string): VendorContract {
  return {
    vendor: 'probe',
    common: [],
    rows: [
      {
        muse: 'PreToolUse',
        vendor: 'probe',
        selection: 'default',
        fields: [{ to, value: 'yes' }],
        result: {
          blockCodes: [2],
          otherExit: 'fail',
          stdout: 'ignore',
          invalid: 'ignore',
          rules: [],
          label: 'probe',
        },
        cite: { input: 'test', output: 'test' },
      },
    ],
  }
}

function isPolluted(): boolean {
  return Object.hasOwn(Object.prototype, 'polluted')
}

afterEach(() => {
  // A failing run must not leak into the rest of the suite.
  Reflect.deleteProperty(Object.prototype, 'polluted')
})

describe('contract engine paths (M91 lane W, semgrep prototype-pollution-loop)', () => {
  it('reads own keys only and never a prototype segment', () => {
    const output: unknown = JSON.parse('{"__proto__":{"polluted":"yes"},"a":{"b":"c"}}')
    expect(pathValue(output, 'a.b')).toBe('c')
    expect(pathValue(output, '__proto__')).toBeUndefined()
    expect(pathValue(output, '__proto__.polluted')).toBeUndefined()
    expect(pathValue({}, 'constructor')).toBeUndefined()
    expect(pathValue({}, 'constructor.prototype')).toBeUndefined()
    expect(pathValue({ a: {} }, 'a.toString')).toBeUndefined()
    expect(pathValue({ a: null }, 'a')).toBeNull()
  })

  it.each(['__proto__.polluted', 'constructor.prototype.polluted', 'a.__proto__.polluted'])(
    'writes nothing through %s',
    (dotted) => {
      const target: Record<string, unknown> = {}
      expect(isSafePath(dotted)).toBe(false)
      setPath(target, dotted, 'yes')
      expect(Object.keys(target)).toEqual([])
      expect(Object.getPrototypeOf(target)).toBe(Object.prototype)
      expect(isPolluted()).toBe(false)
    },
  )

  it('builds nested stdin records that inherit nothing', () => {
    const target: Record<string, unknown> = {}
    expect(isSafePath('tool_info.command_line')).toBe(true)
    setPath(target, 'tool_info.command_line', 'ls')
    expect(JSON.stringify(target)).toBe('{"tool_info":{"command_line":"ls"}}')
    expect(Object.getPrototypeOf(target['tool_info'])).toBeNull()
  })

  it('refuses a build whose table names a prototype path, blocking a blocking row', () => {
    const built = buildStdin(contractWriting('__proto__.polluted'), 'PreToolUse', {}, undefined)
    expect(built).toMatchObject({ outcome: 'refused', blockOperation: true })
    expect(isPolluted()).toBe(false)
    expect(buildStdin(contractWriting('safe.field'), 'PreToolUse', {}, undefined)).toEqual({
      outcome: 'run',
      stdin: '{"safe":{"field":"yes"}}',
    })
  })
})
