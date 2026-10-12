import * as z from 'zod/mini'
import { expect, it } from 'vitest'
import { REPORT_KINDS, REPORT_MAX_TEXT_CHARS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { REPORT_KIND_REGISTRY } from '../../src/core/reporting/registry'
import {
  awaitReportRead,
  readReportField,
  readReportRows,
} from '../../src/core/reporting/sources/boundary'
import { reportOptions } from './helpers/reporting/snapshot'

const schema = z.strictObject({
  name: z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS)),
})
const good = { name: 'good' }
const failures = [
  'throw',
  'reject',
  'null',
  'undefined',
  'wrongType',
  'overlong',
  'length',
  'slot',
  'iterator',
  'brand',
  'code',
  'prototype',
] as const
const cases = REPORT_KINDS.flatMap((kind) => failures.map((boundary) => ({ kind, boundary })))
function poison(boundary: string): unknown {
  if (boundary === 'prototype')
    return new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('poisoned prototype')
        },
      },
    )
  const error = {}
  Object.defineProperty(error, boundary === 'brand' ? 'isLocalSourceError' : 'code', {
    get() {
      throw new Error('poisoned recovery getter')
    },
  })
  if (boundary === 'code') Object.defineProperty(error, 'isLocalSourceError', { value: true })
  return error
}

it.each(cases)(
  '$kind isolates the $boundary boundary with named problems',
  async ({ kind, boundary }) => {
    const facet = REPORT_KIND_REGISTRY[kind].sections[0]
    const context = {
      reportText: EN,
      options: reportOptions(kind),
      asOf: '2026-10-06T12:00:00Z',
      workspaceKey: 'fixture',
      signal: new AbortController().signal,
    }
    const input: unknown[] = [good, good, good]
    switch (boundary) {
      case 'slot': {
        Object.defineProperty(input, 1, {
          get() {
            throw new Error('slot')
          },
        })
        break
      }
      case 'iterator': {
        Object.defineProperty(input, Symbol.iterator, {
          get() {
            throw new Error('iterator')
          },
        })
        break
      }
      case 'length': {
        const proxy = new Proxy(input, {
          get(target, key): unknown {
            if (key === 'length') throw new Error('length')
            return Reflect.get(target, key)
          },
        })
        const result = readReportRows(EN, facet, kind, proxy, schema)
        expect(result.problems[0]?.reason).toContain(EN.reportLabels[facet])
        return
      }
      case 'reject': {
        // An Error, so the rejection itself is well-formed; its recovery
        // accessors still throw, which the boundary must survive.
        const rejection = new Error('rejected read')
        Object.defineProperties(rejection, {
          isLocalSourceError: { value: true },
          code: {
            get(): never {
              throw new Error('poisoned recovery getter')
            },
          },
        })
        const result = await awaitReportRead(
          context,
          facet,
          kind,
          () => Promise.reject(rejection),
          schema,
        )
        expect(result.status).toBe('unavailable')
        if (result.status !== 'unavailable') throw new Error('Expected a problem')
        expect(result.problem.reason).toContain(EN.reportLabels[facet])
        expect(readReportField(EN, facet, kind, () => good, schema).status).toBe('available')
        return
      }
      case 'brand':
      case 'code':
      case 'prototype':
      case 'throw': {
        const thrown = boundary === 'throw' ? new Error('decode') : poison(boundary)
        input[1] = Object.defineProperty({}, 'name', {
          get(): never {
            throw thrown
          },
        })
        break
      }
      case 'null': {
        input[1] = null
        break
      }
      case 'undefined': {
        input[1] = undefined
        break
      }
      case 'wrongType': {
        input[1] = { name: 1 }
        break
      }
      case 'overlong': {
        input[1] = { name: 'x'.repeat(REPORT_MAX_TEXT_CHARS + 1) }
        break
      }
    }
    const result = readReportRows(EN, facet, kind, input, schema)
    expect(result.rows).toEqual(boundary === 'iterator' ? [good, good, good] : [good, good])
    if (boundary !== 'iterator') {
      expect(result.problems).toHaveLength(1)
      expect(result.problems[0]?.reason).toContain(EN.reportLabels[facet])
      expect(result.problems[0]?.key).toBe(`${kind}/1`)
    }
    expect(readReportField(EN, facet, kind, () => good, schema).status).toBe('available')
  },
)
