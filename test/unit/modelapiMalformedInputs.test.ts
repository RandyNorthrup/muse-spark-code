// Malformed outside-world input on the Model API backend: a broken NDJSON
// stream line, a schema `$ref` with a bad percent-escape, memory tool
// arguments that are not JSON, a packed-output recall with unparseable
// arguments, a strict tool call whose arguments are not JSON, and a broken
// SSE data line. Each reaches the typed outcome (never a crash and never
// another fact) through the real parser.
import { realpathSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseNdjson } from '../../src/core/backends/modelapi/ndjson'
import { jsonOutput } from '../../src/core/backends/modelapi/hookFormats/core'
import { functionParameters } from '../../src/core/backends/modelapi/mcp/functions'
import { placeMemoryCall } from '../../src/core/backends/modelapi/memoryTools'
import { ObservationPack } from '../../src/core/backends/modelapi/observationPack'
import {
  restoreOptionalToolArguments,
  type FunctionToolDefinition,
} from '../../src/core/backends/modelapi/schemas'
import {
  createResponsesCodec,
  ResponsesDecodeError,
} from '../../src/core/backends/modelapi/codecs/responses'
import { MemoryStore } from '../../src/core/memory/memoryStore'
import { canonicalPath } from '../../src/host/canonicalPath'
import { writeFileAtomically } from '../../src/host/fsAtomic'
import { createMemoryIo, systemPath } from '../../src/host/backend/memoryIo'
import {
  CHATGPT_TOOL_NAMESPACE_DESCRIPTION,
  MODEL_API_MODEL_TEXT,
  MODEL_API_TOOLS,
  UI_TEXT,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const encoder = new TextEncoder()

function collected(chunks: readonly Uint8Array[]): Promise<unknown[]> {
  return Array.fromAsync(parseNdjson(chunks))
}

describe('a broken NDJSON stream line', () => {
  it('yields whole values, skips blank keep-alives, and names a malformed line', async () => {
    await expect(collected([encoder.encode('{"a":1}\n\n{"b":2}\n')])).resolves.toEqual([
      { a: 1 },
      { b: 2 },
    ])
    await expect(collected([encoder.encode('{"a":1}\n{oops}\n')])).rejects.toThrow(
      /malformed_ndjson/,
    )
  })
})

describe('unparseable hook and schema input', () => {
  it('reads non-JSON hook stdout as no output', () => {
    expect(jsonOutput('not json')).toBeUndefined()
    expect(jsonOutput('{"permissionDecision":"allow"}')).toEqual({
      permissionDecision: 'allow',
    })
  })

  it('cuts a $ref whose escape is not decodable, instead of failing the schema', () => {
    const result = functionParameters({ $ref: '#/$defs/%ZZ' })
    expect(result.isReplaced).toBe(false)
    expect(result.notes).toContain('an unresolved reference was cut')
  })
})

describe('a packed-output recall with unparseable arguments', () => {
  it('fails with the recall refusal, not with a lookup of nothing', () => {
    const outcome = new ObservationPack().recall('{not json')
    expect(outcome.output).toBe(`Error: ${MODEL_API_MODEL_TEXT.packInvalidJson}`)
    expect(outcome.failureReason).toBe(UI_TEXT.packRecallInvalid)
  })
})

describe('strict tool arguments that are not JSON', () => {
  const tool: FunctionToolDefinition = {
    type: 'function',
    name: 'read',
    description: 'read',
    parameters: {},
    strict: true,
  }

  it('pass through for the tool parser instead of becoming an empty object', () => {
    expect(restoreOptionalToolArguments('{not json', tool)).toBe('{not json')
  })
})

describe('a broken SSE data line on the responses codec', () => {
  const codec = createResponsesCodec({
    profile: 'chatgpt',
    toolNamespace: 'functions',
    toolNamespaceDescription: CHATGPT_TOOL_NAMESPACE_DESCRIPTION,
  })

  it('ends the turn with a decode error that names only the line length', async () => {
    await expect(
      Array.fromAsync(codec.decodeStream([encoder.encode('data: {oops}\n\n')])),
    ).rejects.toThrow(ResponsesDecodeError)
  })
})

describe('memory tool arguments that are not JSON', () => {
  const paths = { root: '' }
  beforeAll(async () => {
    paths.root = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-memory-args-')))
  })
  afterAll(async () => {
    await removeFolder(paths.root)
  })

  it('refuses before placing any note', async () => {
    const store = new MemoryStore({
      io: createMemoryIo(
        {
          readFile: () => Promise.resolve(undefined),
          writeFile: (absolutePath: string, content: string) =>
            writeFileAtomically(absolutePath, content, { sleep: () => Promise.resolve() }),
          realPath: canonicalPath,
          hasUnsavedChanges: () => false,
        },
        { warn: () => undefined },
      ),
      platform: process.platform,
      dataRoot: () => path.join(paths.root, 'data'),
      workspaceRoot: path.join(paths.root, 'ws'),
      systemPath,
      warn: () => undefined,
    })
    const result = await placeMemoryCall(store, MODEL_API_TOOLS.readMemory, '{not json')
    expect(result).toEqual({ ok: false, reason: 'arguments are not valid JSON' })
  })
})
