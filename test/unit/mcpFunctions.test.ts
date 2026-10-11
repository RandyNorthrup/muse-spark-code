import { beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import type { createResponsesCodec } from '../../src/core/backends/modelapi/codecs/responses'
import {
  functionParameters,
  mcpCallOutcome,
  mcpFunctionDefinition,
  mcpFunctionName,
} from '../../src/core/backends/modelapi/mcp/functions'
import {
  MAX_IMAGE_BYTES,
  MODEL_API_MODEL_TEXT,
  TOOL_OUTPUT_MAX_CHARS,
} from '../../src/shared/constants'
import { TINY_PNG_BASE64 } from './helpers/fakeModelApi'
import {
  type CreateResponseBody,
  type FunctionToolDefinition,
  restoreOptionalToolArguments,
  withStrictTools,
} from '../../src/core/backends/modelapi/schemas'

// Independent CommonJS builds reproduce modelApi.js -> providers.js metadata handoff.
const separatelyBuilt = { converter: '', provider: '' }
beforeAll(async () => {
  for (const [name, contents] of [
    [
      'converter',
      "export { mcpFunctionDefinition } from './src/core/backends/modelapi/mcp/functions'",
    ],
    [
      'provider',
      "export { withStrictTools, restoreOptionalToolArguments } from './src/core/backends/modelapi/schemas'; export { createResponsesCodec } from './src/core/backends/modelapi/codecs/responses'",
    ],
  ] as const) {
    const result = await build({
      stdin: { contents, resolveDir: process.cwd() },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.18',
      write: false,
      logLevel: 'silent',
    })
    separatelyBuilt[name] = result.outputFiles[0]?.text ?? ''
  }
})

function bundledExports(source: string): Record<string, unknown> {
  const module = { exports: {} }
  runInNewContext(source, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    Buffer,
  })
  return z.record(z.string(), z.unknown()).parse(module.exports)
}

// Meta's function name rule (tool-calling): `[A-Za-z0-9_.-]`, at most one dot.
const META_NAME = /^[A-Za-z0-9_-]+$/
// The row's label splits the name as M43 does.
const LABEL = /^mcp__(.+?)__(.+)$/

describe('mcpFunctionName (M50)', () => {
  it('names a tool mcp__<server>__<tool>, as Muse Code does', () => {
    expect(mcpFunctionName('github', 'create_issue', new Set())).toBe('mcp__github__create_issue')
  })

  it('keeps to the characters Meta allows, and the label splits where it was joined', () => {
    const name = mcpFunctionName('my.docs server__v2', 'files/read.all', new Set())
    expect(name).toBe('mcp__my_docs_server_v2__files_read_all')
    expect(name).toMatch(META_NAME)
    expect(LABEL.exec(name)?.slice(1)).toEqual(['my_docs_server_v2', 'files_read_all'])
    expect(mcpFunctionName('...', '', new Set())).toBe('mcp__server__tool')
  })

  it('ends a long or taken name in a hash of the real names, within 64 characters', () => {
    const long = mcpFunctionName('a-very-long-server-name-indeed', 'x'.repeat(80), new Set())
    expect(long).toHaveLength(64)
    expect(long).toMatch(/^mcp__a-very-long-server-n__x+_[0-9a-f]{8}$/)
    const taken = new Set(['mcp__docs__search'])
    const second = mcpFunctionName('docs', 'search', taken)
    expect(second).toMatch(/^mcp__docs__search_[0-9a-f]{8}$/)
    expect(mcpFunctionName('docs', 'search', taken)).toBe(second)
  })
})

describe('functionParameters (M50)', () => {
  it('passes a plain schema through', () => {
    const schema = {
      type: 'object',
      properties: { text: { type: 'string', description: 'd' } },
      required: ['text'],
    }
    expect(functionParameters(schema)).toEqual({ parameters: schema, notes: [], isReplaced: false })
  })

  it('writes local references out, drops the definitions and the root metadata', () => {
    const { parameters, notes } = functionParameters({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { when: { $ref: '#/$defs/Date', description: 'the day' } },
      $defs: { Date: { $ref: '#/definitions/Iso' } },
      definitions: { Iso: { type: 'string', format: 'date' } },
    })
    expect(parameters).toEqual({
      type: 'object',
      properties: { when: { type: 'string', format: 'date', description: 'the day' } },
    })
    expect(notes).toEqual([])
  })

  it('cuts a recursive reference where it recurs, and one that names nothing', () => {
    const { parameters, notes } = functionParameters({
      type: 'object',
      properties: {
        tree: { $ref: '#/$defs/Node' },
        remote: { $ref: 'https://example.test/schema.json', description: 'kept' },
        broken: { $ref: '#/$defs/%E0%A4%A' },
      },
      $defs: {
        Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' } } },
      },
    })
    expect(parameters['properties']).toEqual({
      tree: { type: 'object', properties: { child: {} } },
      remote: { description: 'kept' },
      broken: {},
    })
    expect(notes).toEqual(['a recursive reference was cut', 'an unresolved reference was cut'])
  })

  it('adds the root type, and cuts what is nested past ten levels', () => {
    let deep: Record<string, unknown> = { type: 'string' }
    for (let level = 0; level < 12; level += 1) {
      deep = { type: 'object', properties: { next: deep } }
    }
    const { parameters, notes } = functionParameters({ properties: { root: deep } })
    expect(parameters['type']).toBe('object')
    expect(JSON.stringify(parameters)).toContain('"next":{}')
    expect(notes).toEqual(['parts nested deeper than 10 levels were cut'])
  })

  it('offers "an object" for a schema past the limits or not an object, and says so', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 5001 }, (_value, index) => [`p${String(index)}`, { type: 'string' }]),
    )
    for (const schema of [{ type: 'object', properties }, { type: 'array' }]) {
      const result = functionParameters(schema)
      expect(result.isReplaced).toBe(true)
      expect(result.parameters).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: true,
      })
    }
    expect(functionParameters('nonsense')).toEqual({
      parameters: { type: 'object' },
      notes: [],
      isReplaced: false,
    })
    const enumValues = Array.from({ length: 1001 }, (_value, index) => index)
    expect(functionParameters({ properties: { n: { enum: enumValues } } }).isReplaced).toBe(true)
  })

  it('drops a single string enum too large for the Model API, keeping its type', () => {
    const values = Array.from(
      { length: 300 },
      (_value, index) => `value-${'v'.repeat(60)}-${String(index)}`,
    )
    const { parameters, notes, isReplaced } = functionParameters({
      type: 'object',
      properties: { pick: { type: 'string', enum: values }, fixed: { const: 'c', enum: ['a'] } },
    })
    expect(isReplaced).toBe(false)
    expect(parameters['properties']).toEqual({
      pick: { type: 'string' },
      fixed: { const: 'c', enum: ['a'] },
    })
    expect(notes).toEqual(['an enum too large for the Model API was dropped'])
  })

  it('rewrites every place a subschema can sit', () => {
    const inner = { $ref: '#/$defs/S' }
    const { parameters } = functionParameters({
      type: 'object',
      properties: {
        list: { type: 'array', items: inner, prefixItems: [inner] },
        either: { anyOf: [inner, { type: 'null' }], not: inner },
        map: { type: 'object', additionalProperties: inner, patternProperties: { '^x': inner } },
        tuple: { items: [inner] },
        odd: { anyOf: 'not a list', patternProperties: 'not a map' },
      },
      $defs: { S: { type: 'string' } },
    })
    const S = { type: 'string' }
    expect(parameters['properties']).toEqual({
      list: { type: 'array', items: S, prefixItems: [S] },
      either: { anyOf: [S, { type: 'null' }], not: S },
      map: { type: 'object', additionalProperties: S, patternProperties: { '^x': S } },
      tuple: { items: [S] },
      odd: { anyOf: 'not a list', patternProperties: 'not a map' },
    })
  })
})

describe('mcpFunctionDefinition (M50)', () => {
  it('preserves fallback and original schemas across independently built bundles (RVM106T F1)', () => {
    const converter = z
      .custom<typeof mcpFunctionDefinition>((value) => typeof value === 'function')
      .parse(bundledExports(separatelyBuilt.converter)['mcpFunctionDefinition'])
    const provider = bundledExports(separatelyBuilt.provider)
    const rewrite = z
      .custom<typeof withStrictTools>((value) => typeof value === 'function')
      .parse(provider['withStrictTools'])
    const restore = z
      .custom<typeof restoreOptionalToolArguments>((value) => typeof value === 'function')
      .parse(provider['restoreOptionalToolArguments'])
    const fallback = converter('mcp__s__pattern', {
      name: 'pattern',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string', pattern: '^src/' } },
      },
    })
    const codecFactory = z
      .custom<typeof createResponsesCodec>((value) => typeof value === 'function')
      .parse(provider['createResponsesCodec'])
    const codec = codecFactory({
      sendPromptCacheKey: false,
      sendPromptCacheRetention: false,
      supportsStrictTools: true,
    })
    const body: CreateResponseBody = {
      model: 'm',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read' }] }],
      instructions: 'Read',
      tools: [{ ...fallback.definition }],
      tool_choice: 'auto',
      reasoning: { effort: 'medium', summary: 'auto' },
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      max_output_tokens: 8192,
      prompt_cache_key: 'strict-test',
      prompt_cache_retention: 'in_memory',
    }
    expect(codec.encodeRequest(body)).toMatchObject({
      tools: [{ strict: false, parameters: fallback.definition.parameters }],
    })
    expect(rewrite([{ ...fallback.definition }], true)[0]).toMatchObject({ strict: false })
    expect(restore('{"path":null}', fallback.definition)).toBe('{"path":null}')
    const original: FunctionToolDefinition = {
      type: 'function',
      name: 'read',
      description: 'Read',
      strict: false,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' } },
      },
    }
    const rewritten = withStrictTools([original], true)[0]
    expect(rewritten).toBeDefined()
    if (rewritten === undefined) throw new Error('Missing strict declaration')
    const twice = rewrite([rewritten], true)[0]
    if (twice === undefined) throw new Error('Missing encoded declaration')
    expect(restore('{"path":null}', twice)).toBe('{}')
    expect(JSON.stringify(rewrite([rewritten], true))).not.toContain('originalToolParameters')
  })

  it.each([
    ['omitted root closure', { type: 'object' }],
    ['explicitly open root', { type: 'object', additionalProperties: true }],
    ['schema-valued root openness', { type: 'object', additionalProperties: { type: 'string' } }],
    [
      'omitted nested closure',
      {
        type: 'object',
        additionalProperties: false,
        required: ['map'],
        properties: { map: { type: 'object' } },
      },
    ],
    [
      'open nullable object',
      {
        type: 'object',
        additionalProperties: false,
        properties: { map: { type: ['object', 'null'] } },
      },
    ],
    [
      'open array item',
      {
        type: 'object',
        additionalProperties: false,
        properties: { maps: { type: 'array', items: { type: 'object' } } },
      },
    ],
    [
      'pattern constraint',
      {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string', pattern: '^src/' } },
      },
    ],
    [
      'union combinator',
      {
        type: 'object',
        additionalProperties: false,
        properties: { value: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
      },
    ],
    [
      'nullable optional enum excluding null',
      {
        type: 'object',
        additionalProperties: false,
        properties: { choice: { type: ['string', 'null'], enum: ['a'] } },
      },
    ],
    [
      'null-only optional enum excluding null',
      {
        type: 'object',
        additionalProperties: false,
        properties: { choice: { type: 'null', enum: ['a'] } },
      },
    ],
    [
      'boolean subschema',
      { type: 'object', additionalProperties: false, properties: { value: true } },
    ],
    [
      'tuple items',
      {
        type: 'object',
        additionalProperties: false,
        properties: { values: { type: 'array', items: [{ type: 'string' }] } },
      },
    ],
  ])(
    'keeps %s non-strict with an honest lossless-conversion note (RVM106T F3)',
    (_form, inputSchema) => {
      const { definition, notes } = mcpFunctionDefinition('mcp__s__schema', {
        name: 'schema',
        inputSchema,
      })
      expect(withStrictTools([definition], true)[0]).toBe(definition)
      expect(definition.strict).toBe(false)
      expect(notes.filter((note) => note.includes('strict: false'))).toEqual([
        'strict: false; the schema cannot be converted losslessly',
      ])
      expect(restoreOptionalToolArguments('{"arbitrary":1,"map":{"extra":2}}', definition)).toBe(
        '{"arbitrary":1,"map":{"extra":2}}',
      )
    },
  )

  it('promotes closed nested and array schemas without mistaking enum data for schemas (RVM106T F3)', () => {
    const inputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        choice: { type: ['string', 'null'], enum: ['a', null] },
        maps: {
          type: 'array',
          items: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: { type: { type: 'string', enum: ['object'] } },
          },
        },
      },
    }
    const { definition, notes } = mcpFunctionDefinition('mcp__s__closed', {
      name: 'closed',
      inputSchema,
    })
    expect(notes).toEqual([])
    expect(withStrictTools([definition], true)[0]?.strict).toBe(true)
  })

  it('keeps unconvertible MCP tools non-strict without blocking convertible tools (M106)', () => {
    const good = mcpFunctionDefinition('mcp__s__good', {
      name: 'good',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, limit: { type: 'integer' } },
        required: ['path'],
        additionalProperties: false,
      },
    })
    const bad = mcpFunctionDefinition('mcp__s__bad', {
      name: 'bad',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', pattern: '^src/' } },
      },
    })
    const definitions = [good.definition, bad.definition]
    const before = JSON.stringify(definitions)
    const strict = withStrictTools(definitions, true)
    expect(strict[0]).toMatchObject({
      strict: true,
      parameters: {
        required: ['path', 'limit'],
        properties: { limit: { type: ['integer', 'null'] } },
      },
    })
    expect(strict[1]).toBe(bad.definition)
    expect(strict[1]?.strict).toBe(false)
    expect(withStrictTools([{ ...bad.definition }], true)[0]?.strict).toBe(false)
    expect(bad.notes.filter((note) => note.includes('strict: false'))).toHaveLength(1)
    expect(good.notes).toEqual([])
    expect(JSON.stringify(definitions)).toBe(before)
    expect(withStrictTools(definitions, false)).toBe(definitions)
    expect(restoreOptionalToolArguments('{"path":null}', bad.definition)).toBe('{"path":null}')
  })

  it('does not certify a lossy MCP fit as strict even when the fitted schema converts (M106)', () => {
    const values = Array.from({ length: 300 }, (_, index) => `${'v'.repeat(60)}-${String(index)}`)
    for (const inputSchema of [
      {
        type: 'object',
        properties: { choice: { type: 'string', enum: values } },
      },
      {
        type: 'object',
        properties: { choice: { $ref: '#/$defs/S', enum: ['b'] } },
        $defs: { S: { type: 'string', enum: ['a'] } },
      },
      { type: 'array' },
      undefined,
    ]) {
      const { definition, notes } = mcpFunctionDefinition('mcp__s__lossy', {
        name: 'lossy',
        inputSchema,
      })
      expect(withStrictTools([definition], true)[0]).toBe(definition)
      expect(notes.filter((note) => note.includes('strict: false'))).toHaveLength(1)
      // Eligibility is internal: the canonical request retains exactly its wire fields.
      expect(Object.keys(definition)).toEqual([
        'type',
        'name',
        'description',
        'parameters',
        'strict',
      ])
    }
  })

  it('describes the tool by its description, else its title, else its name, clipped', () => {
    const plain = mcpFunctionDefinition('mcp__s__t', {
      name: 't',
      description: 'd'.repeat(3000),
      inputSchema: { type: 'object' },
    })
    const wire = JSON.stringify(plain.definition)
    expect(JSON.parse(wire)).toEqual({
      type: 'function',
      name: 'mcp__s__t',
      description: `${'d'.repeat(2048)}…`,
      parameters: { type: 'object' },
      strict: false,
    })
    const titled = mcpFunctionDefinition('mcp__s__t', {
      name: 't',
      annotations: { title: 'Annotated' },
      title: 'Titled',
    })
    expect(titled.definition.description).toBe('Annotated')
    expect(mcpFunctionDefinition('n', { name: 't', title: 'Titled' }).definition.description).toBe(
      'Titled',
    )
    expect(mcpFunctionDefinition('n', { name: 't' }).definition.description).toBe('t')
  })

  it('tells the model when the schema could not be kept', () => {
    const { definition, notes } = mcpFunctionDefinition('n', {
      name: 't',
      description: 'Does a thing',
      inputSchema: { type: 'array' },
    })
    expect(definition.description).toBe(`Does a thing\n\n${MODEL_API_MODEL_TEXT.mcpSchemaReplaced}`)
    expect(notes).toEqual([
      'the schema is past the Model API limits or not an object',
      'strict: false; the schema cannot be converted losslessly',
    ])
  })
})

describe('mcpCallOutcome (M50)', () => {
  it('passes text on, joined', () => {
    expect(
      mcpCallOutcome({
        content: [
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
        ],
      }),
    ).toEqual({ output: 'one\ntwo', visibleOutput: 'one\ntwo' })
  })

  it('passes a picture on as an input_image part, its type read from its bytes', () => {
    const outcome = mcpCallOutcome({
      content: [
        { type: 'text', text: 'a dot' },
        { type: 'image', data: TINY_PNG_BASE64, mimeType: 'image/jpeg' },
      ],
    })
    expect(outcome.outputParts).toEqual([
      { type: 'input_text', text: 'a dot' },
      {
        type: 'input_image',
        image_url: `data:image/png;base64,${TINY_PNG_BASE64}`,
        detail: 'auto',
      },
    ])
    expect(outcome.output).toBe('a dot')
    expect(outcome.visibleOutput).toBe('a dot\n[image image/jpeg]')
  })

  it('describes a picture Meta could not read instead of sending it', () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')
    const outcome = mcpCallOutcome({
      content: [
        { type: 'image', data: 'not base64!', mimeType: 'image/png' },
        {
          type: 'image',
          data: Buffer.from('plain text').toString('base64'),
          mimeType: 'image/png',
        },
        { type: 'image', data: big, mimeType: 'image/png' },
      ],
    })
    expect(outcome.outputParts).toBeUndefined()
    expect(outcome.output.split('\n')).toEqual([
      '[image image/png not passed on: its data is not base64]',
      '[image image/png not passed on: it is not a PNG, JPEG, GIF or WebP image]',
      `[image image/png not passed on: it is over ${String(MAX_IMAGE_BYTES)} bytes]`,
    ])
  })

  it('describes audio, links and resources in words, and an image resource as a picture', () => {
    const outcome = mcpCallOutcome({
      content: [
        { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' },
        { type: 'resource_link', uri: 'file:///a.txt', name: 'a.txt', description: 'notes' },
        { type: 'resource_link', uri: 'file:///b.txt' },
        { type: 'resource', resource: { uri: 'file:///c.txt', text: 'hello' } },
        { type: 'resource', resource: { uri: 'file:///d.bin', blob: 'AAAA' } },
        {
          type: 'resource',
          resource: { uri: 'file:///e.png', mimeType: 'image/png', blob: TINY_PNG_BASE64 },
        },
        { type: 'hologram' },
        'not even an object',
      ],
    })
    expect(outcome.output.split('\n')).toEqual([
      `[audio audio/wav not passed on: ${MODEL_API_MODEL_TEXT.mcpTextAndImagesOnly}]`,
      '[resource link] a.txt: file:///a.txt (notes)',
      '[resource link] file:///b.txt: file:///b.txt',
      '[resource file:///c.txt]',
      'hello',
      `[resource file:///d.bin (binary) not passed on: ${MODEL_API_MODEL_TEXT.mcpTextAndImagesOnly}]`,
      '[content of type hologram not passed on]',
      '[content of type unknown not passed on]',
    ])
    expect(outcome.outputParts).toHaveLength(2)
  })

  it('reads structured content when there is no text, and says when there was nothing', () => {
    expect(mcpCallOutcome({ content: [], structuredContent: { n: 1 } }).output).toBe(
      '{\n  "n": 1\n}',
    )
    expect(mcpCallOutcome({})).toEqual({
      output: MODEL_API_MODEL_TEXT.mcpNoContent,
      visibleOutput: MODEL_API_MODEL_TEXT.mcpNoContent,
    })
  })

  it('marks a tool error, and clips a flood', () => {
    expect(
      mcpCallOutcome({ content: [{ type: 'text', text: 'it broke' }], isError: true }),
    ).toEqual({ output: 'Error: it broke', visibleOutput: 'it broke', failureReason: 'it broke' })
    const flood = mcpCallOutcome({
      content: [{ type: 'text', text: 'y'.repeat(TOOL_OUTPUT_MAX_CHARS + 5) }],
    })
    expect(flood.output).toMatch(/\[output clipped\]$/)
  })
})
