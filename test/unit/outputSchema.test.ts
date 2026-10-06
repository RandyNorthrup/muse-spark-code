import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { compileOutputSchema } from '../../src/runtime/exec/outputSchema'

const encode = (schema: unknown) => new TextEncoder().encode(JSON.stringify(schema))
const closed = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const sample = () =>
  closed({
    ok: { type: 'boolean' },
    note: { type: ['string', 'null'] },
    scores: { type: 'array', items: { type: 'integer', enum: [0, 1, 2] } },
  })

describe('M106 O2 strict output schema', () => {
  it('validates the captured U10 strict schema and its answer without changing the schema', async () => {
    const capture: unknown = JSON.parse(
      await readFile('test/fixtures/m106/u10-structured-output.json', 'utf8'),
    )
    const record = z
      .object({
        request: z.object({
          text: z.object({
            format: z.object({
              schema: z.record(z.string(), z.unknown()),
            }),
          }),
        }),
      })
      .parse(capture)
    const bytes = encode(record.request.text.format.schema)
    const schema = compileOutputSchema(bytes)
    expect(schema.schema).toEqual(record.request.text.format.schema)
    expect(schema.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(schema.parseAnswer('{"capital":"Paris","country":"France"}').ok).toBe(true)
  })
  it('preserves typed JSON and checks required keys, unknown keys, nullable types, integer enums and arrays', () => {
    const schema = compileOutputSchema(encode(sample()))
    const value = { ok: true, note: null, scores: [0, 2] }
    expect(schema.parseAnswer(JSON.stringify(value))).toEqual({ ok: true, value })
    for (const answer of [
      { ok: true, scores: [] },
      { ...value, extra: 1 },
      { ...value, ok: 'true' },
      { ...value, note: 0 },
      { ...value, scores: [1.5] },
      { ...value, scores: [3] },
      { ...value, scores: {} },
      [],
      null,
    ])
      expect(schema.parseAnswer(JSON.stringify(answer)).ok).toBe(false)
    expect(schema.parseAnswer('```json\n{}\n```')).toEqual({ ok: false, detail: 'JSON' })
    const integer = compileOutputSchema(encode(closed({ a: { type: 'integer' } })))
    expect(integer.parseAnswer('{"a":1.5}').ok).toBe(false)
  })
  it.each([
    { type: 'string' },
    { anyOf: [closed({}), closed({})] },
    { ...closed({ a: { type: 'string' } }), required: [] },
    { ...closed({ a: { type: 'string' } }), required: ['a', 'a'] },
    { ...closed({}), additionalProperties: true },
    { ...closed({}), additionalProperties: undefined },
    closed({ a: { type: 'array' } }),
    closed({ a: { type: 'string', minLength: 1 } }),
    closed({ a: { type: 'number', minimum: 0 } }),
    closed({ a: { type: 'string', default: 'x' } }),
    closed({ a: { type: ['string', 'number'] } }),
    closed({ a: { type: ['null', 'null'] } }),
    closed({ a: { type: 'string', enum: [] } }),
    closed({ a: { type: 'integer', enum: [1.5] } }),
    closed({ a: { type: 'boolean', enum: [true, true] } }),
    closed({ a: { type: 'string', enum: ['x', null] } }),
    closed({ a: { anyOf: [{ type: 'string' }] } }),
    closed({ a: { type: 'string', anyOf: [{ type: 'string' }, { type: 'null' }] } }),
    closed({ a: { $ref: 'https://example.com/schema.json' } }),
    closed({ a: { $ref: '#/$defs/missing' } }),
    closed({ a: { type: 'string', items: { type: 'string' } } }),
  ])('refuses unsupported or lossy grammar before returning a format: %j', (schema) => {
    expect(() => compileOutputSchema(encode(schema))).toThrow('strict subset')
  })
  it('supports nested unions and recursive local definitions, with bounded answers', () => {
    const node = closed({
      value: { type: 'string' },
      next: { anyOf: [{ type: 'null' }, { $ref: '#' }] },
    })
    const schema = compileOutputSchema(encode(node))
    expect(schema.parseAnswer('{"value":"a","next":{"value":"b","next":null}}').ok).toBe(true)
    expect(schema.parseAnswer('{"value":"a","next":{"value":1,"next":null}}').ok).toBe(false)
    const definition = compileOutputSchema(
      encode({
        ...closed({ answer: { $ref: '#/$defs/a~1b' } }),
        $defs: { 'a/b': { type: 'boolean' } },
      }),
    )
    expect(definition.parseAnswer('{"answer":false}').ok).toBe(true)
    expect(definition.parseAnswer('{"answer":"false"}').ok).toBe(false)
    let value: unknown = null
    for (let index = 0; index < 30; index += 1) value = { value: 'a', next: value }
    expect(schema.parseAnswer(JSON.stringify(value))).toEqual({
      ok: false,
      detail: 'depth / nodes',
    })
  })
  it('refuses malformed UTF-8/JSON, byte overflow and deep grammar without a stack overflow', () => {
    expect(() => compileOutputSchema(Uint8Array.of(255))).toThrow('JSON')
    expect(() => compileOutputSchema(new TextEncoder().encode('{'))).toThrow('JSON')
    expect(() => compileOutputSchema(new Uint8Array(262_145))).toThrow('bytes')
    let deep: unknown = { type: 'string' }
    for (let index = 0; index < 20; index += 1) deep = closed({ a: deep })
    expect(() => compileOutputSchema(encode(deep))).toThrow('depth')
  })
  it('refuses reference-only cycles before parsing an answer', () => {
    expect(() =>
      compileOutputSchema(
        encode({
          ...closed({ answer: { $ref: '#/$defs/a' } }),
          $defs: { a: { anyOf: [{ type: 'null' }, { $ref: '#/$defs/a' }] } },
        }),
      ),
    ).toThrow('$ref cycle')
  })
  it('enforces strict grammar resource limits and answer node limits', () => {
    expect(() =>
      compileOutputSchema(encode({ ...closed({}), description: 'x'.repeat(120_001) })),
    ).toThrow('strings')
    const properties = Object.fromEntries(
      Array.from({ length: 5001 }, (_, index) => [`p${String(index)}`, { type: 'null' }]),
    )
    expect(() => compileOutputSchema(encode(closed(properties)))).toThrow('properties')
    expect(() =>
      compileOutputSchema(
        encode(
          closed({
            a: { type: 'integer', enum: Array.from({ length: 1001 }, (_, index) => index) },
          }),
        ),
      ),
    ).toThrow('enum')
    expect(() =>
      compileOutputSchema(
        encode(
          closed({
            a: {
              type: 'string',
              enum: Array.from({ length: 251 }, (_, index) => `${String(index)}${'x'.repeat(61)}`),
            },
          }),
        ),
      ),
    ).toThrow('enum strings')
    let deep: unknown = { type: 'null' }
    for (let index = 0; index < 11; index += 1) deep = { type: 'array', items: deep }
    expect(() => compileOutputSchema(encode(closed({ a: deep })))).toThrow('depth')
    const schema = compileOutputSchema(
      encode(closed({ a: { type: 'array', items: { type: 'null' } } })),
    )
    expect(
      schema.parseAnswer(JSON.stringify({ a: Array.from({ length: 200_001 }, () => null) })),
    ).toEqual({ ok: false, detail: 'depth / nodes' })
  })
  it('digests exact bytes, including whitespace, without retaining a path', () => {
    const a = encode(closed({}))
    const b = new TextEncoder().encode(`${new TextDecoder().decode(a)}\n`)
    expect(compileOutputSchema(a).sha256).not.toBe(compileOutputSchema(b).sha256)
  })
})
