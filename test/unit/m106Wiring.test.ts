import { gitDraftContract } from '../../src/core/git/gitText'
import { ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as entry from '../../src/host/backend/modelApiEntry'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { fakeModelApi } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { watchSessionTurns } from './helpers/sessionTurns'
import { FakeLogOutputChannel } from './helpers/fakes'
import { execOutputSchemaPort } from '../../src/runtime/exec/runExec'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { execEventSchema, validateResult } from '../../src/runtime/exec/execProtocol'
import { compileOutputSchema } from '../../src/runtime/exec/outputSchema'
import { resultRecord } from './helpers/execContract'
import { M106_CAPTURED_META_MODEL, UI_TEXT } from '../../src/shared/constants'
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

async function schemaSession() {
  const h = manager(() => false)
  const host = await h.m.ensureHost()
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: M106_CAPTURED_META_MODEL,
    approvalMode: 'allowAll',
  })
  if (!(session instanceof ModelApiSession)) throw new Error('Expected Model API session')
  return { h, host, session }
}

describe('M106 integrated wiring', () => {
  it.each(['normal', 'attempt'] as const)(
    'snapshots continuation off in the %s factory and fails cut-short tool calls without dispatching them',
    async (factory) => {
      const api = fakeModelApi()
      const log = new FakeLogOutputChannel()
      const io = memoryToolIo({}, '/ws')
      const read = vi.spyOn(io, 'readFile')
      let isContinuationOn = false
      const m = new ModelApiBackendManager(
        fakeManagerDeps(api, log, {
          workspaceRoot: '/ws',
          bundlePath: 'source',
          loadBundle: () => entry,
          io,
          outputContinuation: () => isContinuationOn,
        }),
      )
      const host =
        factory === 'normal'
          ? await m.ensureHost()
          : await m.buildAttemptHost('/ws', () => undefined)
      try {
        const session = await host.startSession({
          workspaceRoot: '/ws',
          modelId: 'muse-spark-1.3',
          approvalMode: 'allowAll',
        })
        const { events, turnDone } = watchSessionTurns(session)
        isContinuationOn = true
        api.script(
          {
            calls: [{ name: 'read_file', arguments: '{"path":"unsafe.txt"}', callId: 'cut' }],
            incomplete: { reason: 'max_output_tokens' },
          },
          { text: 'Unexpected continuation.' },
        )
        await session.sendTurn([{ type: 'text', text: 'read' }])
        await turnDone()
        expect(events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
          terminal: 'failed',
          reason: UI_TEXT.incompleteToolCallsNotRun,
        })
        expect(api.responseBodies()).toHaveLength(1)
        expect(read).not.toHaveBeenCalled()
        expect(events).toContainEqual({
          type: 'itemCompleted',
          item: expect.objectContaining({ kind: 'toolCall', status: 'failed' }),
        })
      } finally {
        if (factory === 'attempt') await host.close()
        await m.dispose()
      }
    },
  )

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
    const { h, host, session } = await schemaSession()
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

  it('compacts with its own schema after two refusals without inheriting the exec answer format', async () => {
    const { h, host, session } = await schemaSession()
    try {
      host.configureOutputSchema(
        session.sessionId,
        M106_CAPTURED_META_MODEL,
        'strict_schema',
        closedSchema,
      )
      h.api.script({ text: '{"ok":true}' })
      await session.sendTurn([{ type: 'text', text: 'answer' }])
      await session.settled()
      h.api.script(
        { httpError: { status: 400 } },
        { httpError: { status: 400 } },
        { text: 'Summary of the actual work' },
      )
      await expect(session.compact()).resolves.toMatchObject({ status: 'accepted' })
      const summaries = h.api.responseBodies().slice(1)
      expect(summaries).toHaveLength(3)
      for (const body of summaries.slice(0, 2))
        expect(body['text']).toMatchObject({ format: { name: 'compaction_summary', strict: true } })
      expect(summaries[2]).not.toHaveProperty('text')
      expect(JSON.stringify(session.snapshot().replay)).toContain('Summary of the actual work')
      h.api.script({ text: '{"ok":true}' })
      await session.sendTurn([{ type: 'text', text: 'answer again' }])
      await session.settled()
      expect(h.api.responseBodies().at(-1)?.['text']).toMatchObject({
        format: { name: 'exec_answer' },
      })
    } finally {
      await h.m.dispose()
    }
  })

  it('documents the compiler-supported bounded local references in both output-schema guides', () => {
    const schema = compileOutputSchema(
      new TextEncoder().encode(
        JSON.stringify({
          ...closedSchema,
          properties: { ok: { $ref: '#/$defs/answer' } },
          $defs: { answer: { type: 'boolean' } },
        }),
      ),
    )
    expect(schema.parseAnswer('{"ok":true}').ok).toBe(true)
    for (const file of ['docs/acp.md', 'docs/ci.md']) {
      const guide = readFileSync(file, 'utf8')
      expect(guide).toContain('bounded local `$defs`/`$ref` references')
      expect(guide).toContain('reference-only cycles')
      expect(guide).not.toContain('strict subset rejects references')
    }
  })

  it('refuses a Git repair after a changed model before dispatch', async () => {
    const { h, session } = await schemaSession()
    try {
      const port = session.gitDraftOutput
      const attempt = gitDraftContract('commitMessage', port.formats())
      port.prepare('commitMessage', attempt, new AbortController().signal)
      h.api.script({ text: 'invalid' })
      await session.sendTurn([{ type: 'text', text: 'draft a commit' }])
      await session.settled()
      await session.setModel('muse-spark-1.3')
      h.api.script({ text: '{"message":"Stale repair"}' })
      await expect(
        port.request('commitMessage', { ...attempt, repair: true }, new AbortController().signal),
      ).rejects.toThrow(UI_TEXT.gitDraftFailed)
      expect(h.api.responseBodies()).toHaveLength(1)
    } finally {
      await h.m.dispose()
    }
  })

  it('does not format an ordinary turn from a cancelled pending Git draft', async () => {
    const { h, session } = await schemaSession()
    try {
      const port = session.gitDraftOutput
      const abort = new AbortController()
      port.prepare('commitMessage', gitDraftContract('commitMessage', port.formats()), abort.signal)
      abort.abort()
      h.api.script({ text: 'Ordinary reply' })
      await session.sendTurn([{ type: 'text', text: 'ordinary' }])
      await session.settled()
      expect(h.api.responseBodies()[0]).not.toHaveProperty('text')
    } finally {
      await h.m.dispose()
    }
  })

  it('refuses schema binding while a turn is active and after its replay exists', async () => {
    const { h, host, session } = await schemaSession()
    const held = Promise.withResolvers<undefined>()
    h.api.script({ text: 'done', hold: held.promise })
    await session.sendTurn([{ type: 'text', text: 'work' }])
    expect(() =>
      host.configureOutputSchema(
        session.sessionId,
        M106_CAPTURED_META_MODEL,
        'strict_schema',
        closedSchema,
      ),
    ).toThrow()
    held.resolve(undefined)
    await session.settled()
    expect(() =>
      host.configureOutputSchema(
        session.sessionId,
        M106_CAPTURED_META_MODEL,
        'strict_schema',
        closedSchema,
      ),
    ).toThrow()
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
