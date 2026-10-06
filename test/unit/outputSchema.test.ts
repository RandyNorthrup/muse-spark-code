import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { compileOutputSchema } from '../../src/runtime/exec/outputSchema'

const encode = (schema: unknown) => new TextEncoder().encode(JSON.stringify(schema))
const integerValues = (count: number) => Array.from({ length: count }, (_, index) => index)
const closed = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const enumSchema = (second: number) =>
  closed({
    a: { type: 'integer', enum: integerValues(500) },
    b: { type: 'integer', enum: integerValues(second) },
  })
const sample = () =>
  closed({
    ok: { type: 'boolean' },
    note: { type: ['string', 'null'] },
    scores: { type: 'array', items: { type: 'integer', enum: [0, 1, 2] } },
  })

// Build once; each hostile synchronous probe runs in an isolated process so a
// broken guard cannot prevent Vitest's own deadline from firing.
const probeBundles: string[] = []
beforeAll(() => {
  const bundle = buildSync({
    entryPoints: ['src/runtime/exec/outputSchema.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  })
  probeBundles.push(bundle.outputFiles[0]?.text ?? '')
})
function probe(script: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('probe blocked the event loop'))
    }, 1500)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout))
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      } else {
        reject(new Error(stderr || 'probe failed'))
      }
    })
    child.stdin.end(`${probeBundles.join('')}\n${script}`)
  })
}
const probePrelude = `
const compile = module.exports.compileOutputSchema;
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const closed = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
let timerFired = false;
setTimeout(() => {timerFired = true}, 20);
const started = performance.now();
`

const definitionNameSchema = (size: number) => ({
  ...closed({ a: { $ref: '#/$defs/' + 'x'.repeat(size) } }),
  $defs: { ['x'.repeat(size)]: { type: 'boolean' } },
})

describe('M106 O2 strict output schema', () => {
  it('ships additive v1 schema snapshots preserving every base field and event guard', async () => {
    const read = async (name: string) =>
      z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(await readFile(`docs/schemas/${name}.schema.json`, 'utf8')))
    const base = await read('exec-result-v1')
    const result = await read('exec-result-output-schema-v1')
    const properties = z.record(z.string(), z.unknown()).parse(result['properties'])
    expect(properties['output']).toEqual({})
    delete properties['output']
    const ledger = z.record(z.string(), z.unknown()).parse(properties['ledger'])
    const variants = z.array(z.record(z.string(), z.unknown())).parse(ledger['anyOf'])
    const object = variants.find((variant) => variant['type'] === 'object')
    if (object === undefined) throw new Error('missing ledger object')
    const fields = z.record(z.string(), z.unknown()).parse(object['properties'])
    expect(fields['outputSchemaSha256']).toEqual({
      type: 'string',
      pattern: String.raw`^[a-f\d]{64}$`,
    })
    delete fields['outputSchemaSha256']
    object['properties'] = fields
    ledger['anyOf'] = variants
    properties['ledger'] = ledger
    const conditions = z.array(z.record(z.string(), z.unknown())).parse(result['allOf'])
    expect(conditions.at(-2)?.['if']).toEqual({ required: ['output'] })
    expect(conditions.at(-2)?.['then']).toEqual({
      properties: {
        status: { const: 'completed' },
        ledger: { type: 'object', required: ['outputSchemaSha256'] },
      },
    })
    expect(conditions.at(-1)?.['if']).toEqual({
      properties: {
        status: { const: 'completed' },
        ledger: { type: 'object', required: ['outputSchemaSha256'] },
      },
    })
    expect(conditions.at(-1)?.['then']).toEqual({ required: ['output'] })
    const restored = {
      ...result,
      properties,
      allOf: conditions.slice(0, -2),
      'x-runtime-invariants': z
        .array(z.string())
        .parse(result['x-runtime-invariants'])
        .slice(0, -1),
    }
    expect(restored).toEqual(base)
    const baseEvents = await read('exec-event-v1')
    const events = await read('exec-event-output-schema-v1')
    const eventVariants = z.array(z.record(z.string(), z.unknown())).parse(events['anyOf'])
    for (const variant of eventVariants) {
      const props = z.record(z.string(), z.unknown()).parse(variant['properties'])
      const type = z.object({ const: z.string() }).parse(props['type']).const
      if (type !== 'result') {
        continue
      }

      expect(props['result']).toEqual(result)
      variant['properties'] = { ...props, result: base }
    }
    expect({ ...events, anyOf: eventVariants }).toEqual(baseEvents)
  })
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
    const bom = Uint8Array.from([239, 187, 191, ...a])
    expect(compileOutputSchema(bom).sha256).toBe(createHash('sha256').update(bom).digest('hex'))
    expect(compileOutputSchema(bom).sha256).not.toBe(compileOutputSchema(a).sha256)
  })
  it('refuses exponential reference expansion promptly and lets the 20 ms timer fire', async () => {
    const result = await probe(`${probePrelude}
const defs = {d0: {type: 'boolean'}};
for(let i=1;i<=5;i++) defs['d'+i] = {anyOf:Array.from({length:25},()=>({$ref:'#/$defs/d'+(i-1)}))};
let error;
try {compile(encode({...closed({answer:{$ref:'#/$defs/d5'}}),$defs:defs}))} catch(e) {error=e.message}
const elapsed = performance.now()-started;
setTimeout(()=>process.stdout.write(JSON.stringify({error,elapsed,timerFired})),30);
`)
    expect(result).toMatchObject({
      error: expect.stringMatching(/schema too complex.*[0-9]/u),
      timerFired: true,
    })
    expect(z.object({ elapsed: z.number() }).parse(result).elapsed).toBeLessThan(50)
  })
  it('memoises recursive union answers promptly and lets the 20 ms timer fire', async () => {
    const result = await probe(`${probePrelude}
const schema=compile(encode(closed({value:{type:'string'},next:{anyOf:[{type:'null'},...Array.from({length:10},()=>({$ref:'#'}))]}})));
let answer={value:1,next:null};
for(let i=0;i<8;i++) answer={value:'a',next:answer};
const result=schema.parseAnswer(JSON.stringify(answer));
const elapsed=performance.now()-started;
setTimeout(()=>process.stdout.write(JSON.stringify({result,elapsed,timerFired})),30);
`)
    expect(result).toMatchObject({ result: { ok: false, detail: 'schema' }, timerFired: true })
    expect(z.object({ elapsed: z.number() }).parse(result).elapsed).toBeLessThan(50)
  })
  it('fails closed with a named error when answer validation exhausts its work budget', () => {
    const schema = compileOutputSchema(
      encode(closed({ a: { type: 'array', items: { type: 'integer' } } })),
    )
    expect(schema.parseAnswer(JSON.stringify({ a: integerValues(20_000) }))).toMatchObject({
      ok: false,
      kind: 'output_schema_validation_budget',
      detail: expect.stringContaining('work budget'),
    })
  })
  it('accepts integral JSON numbers beyond the safe-integer range including enums', () => {
    const value = { n: 9_007_199_254_740_992 }
    for (const rule of [{ type: 'integer' }, { type: 'integer', enum: [value.n] }]) {
      const schema = compileOutputSchema(encode(closed({ n: rule })))
      expect(schema.parseAnswer(JSON.stringify(value))).toEqual({ ok: true, value })
      expect(schema.parseAnswer('{"n":1.5}').ok).toBe(false)
    }
  })
  it('counts definition names in the schema string-character budget', () => {
    expect(
      compileOutputSchema(encode(definitionNameSchema(119_999))).parseAnswer('{"a":true}').ok,
    ).toBe(true)
    expect(() => compileOutputSchema(encode(definitionNameSchema(120_000)))).toThrow('strings')
    expect(() => compileOutputSchema(encode(definitionNameSchema(120_001)))).toThrow('strings')
  })
  it('counts enum values across the whole schema before accepting it', () => {
    expect(compileOutputSchema(encode(enumSchema(500))).parseAnswer('{"a":499,"b":499}').ok).toBe(
      true,
    )
    expect(() => compileOutputSchema(encode(enumSchema(501)))).toThrow('enum')
  })
})
