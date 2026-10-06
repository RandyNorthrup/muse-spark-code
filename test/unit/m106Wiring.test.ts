import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as entry from '../../src/host/backend/modelApiEntry'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { fakeModelApi } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { execOutputSchemaPort } from '../../src/runtime/exec/runExec'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { execEventSchema, validateResult } from '../../src/runtime/exec/execProtocol'
import { compileOutputSchema } from '../../src/runtime/exec/outputSchema'
import { resultRecord } from './helpers/execContract'
import { M106_CAPTURED_META_MODEL } from '../../src/shared/constants'
import {
  metaSideCallFormats,
  metaHostedCapabilities,
} from '../../src/core/backends/modelapi/modelCapabilities'

const declarations = z.object({
  tools: z.array(z.object({ type: z.string(), strict: z.optional(z.boolean()) })),
})

const closedSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
}

function manager(isStrictToolsOn: () => boolean) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const m = new ModelApiBackendManager(
    fakeManagerDeps(api, log, {
      workspaceRoot: '/ws',
      bundlePath: 'source',
      loadBundle: () => entry,
      strictTools: isStrictToolsOn,
      parallelReads: () => false,
    }),
  )
  return { api, m }
}

describe('M106 integrated wiring', () => {
  it('snapshots strict off before declarations/cache construction in normal and attempt hosts', async () => {
    let isEnabled = false
    const h = manager(() => isEnabled)
    const host = await h.m.ensureHost()
    const session = await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    isEnabled = true
    h.api.script({ text: 'normal' })
    await session.sendTurn([{ type: 'text', text: 'hello' }])
    await vi.waitFor(() => {
      expect(h.api.responseBodies()).toHaveLength(1)
    })
    const normal = declarations.parse(h.api.responseBodies()[0])
    expect(normal.tools.some((tool) => tool.type === 'function')).toBe(true)
    expect(
      normal.tools.filter((tool) => tool.type === 'function').every((tool) => tool.strict !== true),
    ).toBe(true)
    isEnabled = false
    const attemptHost = await h.m.buildAttemptHost('/trial', () => undefined)
    const attempt = await attemptHost.startSession({
      workspaceRoot: '/trial',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    isEnabled = true
    h.api.script({ text: 'attempt' })
    await attempt.sendTurn([{ type: 'text', text: 'hello' }])
    await vi.waitFor(() => {
      expect(h.api.responseBodies()).toHaveLength(2)
    })
    expect(
      declarations
        .parse(h.api.responseBodies()[1])
        .tools.filter((tool) => tool.type === 'function')
        .every((tool) => tool.strict !== true),
    ).toBe(true)
    await attemptHost.close()
    await h.m.dispose()
  })

  it('binds the captured selected schema format before dispatch and refuses a changed model or repeated binding', async () => {
    const h = manager(() => false)
    const host = await h.m.ensureHost()
    const session = await host.startSession({
      workspaceRoot: '/ws',
      modelId: M106_CAPTURED_META_MODEL,
      approvalMode: 'allowAll',
    })
    expect(
      host.configureOutputSchema(
        'missing',
        M106_CAPTURED_META_MODEL,
        'strict_schema',
        closedSchema,
      ),
    ).toBe(false)
    expect(() => {
      host.configureOutputSchema(session.sessionId, 'different', 'strict_schema', closedSchema)
    }).toThrow()
    host.configureOutputSchema(
      session.sessionId,
      M106_CAPTURED_META_MODEL,
      'strict_schema',
      closedSchema,
    )
    expect(() => {
      host.configureOutputSchema(
        session.sessionId,
        M106_CAPTURED_META_MODEL,
        'strict_schema',
        closedSchema,
      )
    }).toThrow()
    h.api.script({ text: '{"ok":true}' })
    await session.sendTurn([{ type: 'text', text: 'answer' }])
    await vi.waitFor(() => {
      expect(h.api.responseBodies()).toHaveLength(1)
    })
    expect(h.api.responseBodies()[0]?.['text']).toEqual({
      format: {
        type: 'json_schema',
        name: 'exec_answer',
        strict: true,
        schema: closedSchema,
      },
    })
    await h.m.dispose()
  })

  it('uses only counted selected-model captures and leaves unknown models on the local validator', async () => {
    const fixture: unknown = JSON.parse(
      readFileSync('test/fixtures/m106/u10-structured-output.json', 'utf8'),
    )
    expect(fixture).toMatchObject({
      provenance: { model: M106_CAPTURED_META_MODEL },
      request: { text: { format: { type: 'json_schema', strict: true } } },
    })
    expect(await execOutputSchemaPort.formatsFor(M106_CAPTURED_META_MODEL)).toEqual([
      'strict_schema',
    ])
    expect(await execOutputSchemaPort.formatsFor('future-model')).toEqual([])
    expect(metaSideCallFormats('future-model')).toEqual({ state: 'unknown' })
    expect(metaHostedCapabilities('future-model')).toBeUndefined()
  })

  it('parses schema flags through the public CLI and canonical result/event readers enforce output/digest and mismatch code', () => {
    expect(
      parseCommandLine([
        'exec',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '1',
        '--output-schema',
        'answer.json',
        'task',
      ]),
    ).toMatchObject({ command: 'exec', options: { outputSchema: 'answer.json' } })
    const schema = compileOutputSchema(new TextEncoder().encode(JSON.stringify(closedSchema)))
    const base = resultRecord()
    const good = {
      ...base,
      output: { value: { ok: true }, validation: 'local' },
      ledger: { ...base.ledger, outputSchemaSha256: schema.sha256 },
    }
    expect(validateResult(good)).toEqual(good)
    expect(
      execEventSchema.parse({
        v: 2,
        seq: 1,
        time: '2026-10-06T00:00:00.000Z',
        type: 'result',
        result: good,
      }),
    ).toMatchObject({ result: good })
    expect(() => validateResult({ ...good, ledger: base.ledger })).toThrow()
    const failed = {
      ...base,
      status: 'failed',
      exitCode: 10,
      error: { kind: 'output_schema_mismatch', message: 'mismatch' },
    }
    expect(validateResult(failed)).toEqual(failed)
    expect(() => validateResult({ ...failed, exitCode: 4 })).toThrow()
  })
})
