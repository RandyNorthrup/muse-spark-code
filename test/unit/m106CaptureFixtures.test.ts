import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MSP_KNOWN_SCHEMA_FINGERPRINTS } from '../../src/shared/constants'
import { captureFrameRow } from './helpers/wireCapture'

const record = z.record(z.string(), z.unknown())
const captureSchema = z.object({
  provenance: z.object({
    cli: z.literal('1.4.4-R5419.1'),
    workspace: z.string().min(1),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    modelAttempts: z.literal(0),
    requestAttempts: z.number().int().positive(),
    sourceSha256: z.string().regex(/^[a-f\d]{64}$/),
    projection: z.literal(true),
    omitted: z.array(z.string()),
    launchArguments: z.array(z.string()),
  }),
  frames: z.array(captureFrameRow),
})
type Capture = z.infer<typeof captureSchema>
function readFixture(name: string): string {
  return readFileSync(new URL(`../fixtures/m106/${name}`, import.meta.url), 'utf8')
}
function capture(name: string): Capture {
  const value: unknown = JSON.parse(readFixture(`msp-1.4.4-${name}.json`))
  return captureSchema.parse(value)
}
function received(captured: Capture, id: number) {
  const frame = captured.frames.find(
    (row) => row.direction === 'received' && row.frame.id === id,
  )?.frame
  if (!frame) throw new Error('Missing captured response')
  return frame
}
function params(captured: Capture, method: string, direction = 'received') {
  return record.parse(
    captured.frames.find((row) => row.direction === direction && row.frame.method === method)?.frame
      .params,
  )
}
/** The lead's 2026-10-10 live-run envelope both Meta receipts share. */
const liveRequest = {
  method: z.literal('POST'),
  route: z.literal('/responses'),
  authenticated: z.literal(true),
}
const liveReceipt = {
  provenance: z.object({
    timestamp: z.iso.datetime(),
    sourceSha256: z.string().regex(/^[a-f\d]{64}$/),
    projection: z.literal(true),
    omitted: z.array(z.string()),
  }),
}

describe('C-M106-1 counted Muse Code 1.4.4 captures', () => {
  it('captures the pinned fingerprint and actual model variants, descriptions and defaults', () => {
    const data = capture('host-feedback')
    const initialize = z
      .object({
        serverInfo: z.object({ version: z.literal('1.4.4') }),
        schema: z.object({ fingerprint: z.string() }),
        grantedCapabilities: z.array(z.string()),
        sessionDurability: z.literal('ephemeral'),
      })
      .parse(received(data, 1).result)
    expect(Object.keys(MSP_KNOWN_SCHEMA_FINGERPRINTS)).toContain(initialize.schema.fingerprint)
    expect(initialize.grantedCapabilities).toEqual(['sessionListStream', 'feedback'])
    const catalogue = z
      .object({
        source: z.literal('providerCatalog'),
        models: z.array(
          z.object({
            modelId: z.string(),
            variants: z.array(z.string()),
            reasoningEffortVariants: z.array(
              z.object({ tier: z.string(), description: z.string() }),
            ),
            defaultReasoningEffort: z.string(),
            outputLimit: z.number(),
          }),
        ),
      })
      .parse(received(data, 2).result)
    const model = catalogue.models.find((row) => row.modelId === 'muse-spark-1.3-contributor')
    expect(model).toEqual({
      modelId: 'muse-spark-1.3-contributor',
      variants: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      reasoningEffortVariants: [
        { tier: 'xhigh', description: 'Use this for deepest analysis and complex fixes.' },
      ],
      defaultReasoningEffort: 'max',
      outputLimit: 128_000,
    })
    expect(catalogue.models.every((row) => row.variants.includes(row.defaultReasoningEffort))).toBe(
      true,
    )
  })

  it('preserves observed effort and shutdown lifecycle frames without inventing deletion or list changes', () => {
    const data = capture('session-lifecycle')
    const session = z
      .object({
        session: z.object({
          sessionId: z.string(),
          workspaceRoot: z.literal('<capture-workspace>'),
          path: z.literal(''),
          status: z.literal('idle'),
          modelId: z.literal('muse-spark-1.3-contributor'),
        }),
      })
      .parse(received(data, 3).result).session
    expect(
      z
        .object({ session: z.object({ sessionId: z.string() }) })
        .parse(params(data, 'session/started')).session.sessionId,
    ).toBe(session.sessionId)
    expect(
      z
        .object({
          sessionId: z.string(),
          reasoningEffort: z.literal('minimal'),
          source: z.literal('user'),
          viewCursor: z.string(),
          sourceRange: record,
        })
        .parse(params(data, 'session/reasoningEffortChanged')).sessionId,
    ).toBe(session.sessionId)
    expect(
      z
        .object({
          sessionId: z.string(),
          reason: z.literal('hostShutdown'),
          viewCursor: z.string(),
        })
        .parse(params(data, 'session/closed')).sessionId,
    ).toBe(session.sessionId)
    expect(received(data, 6).error).toEqual({
      code: -32_601,
      message: 'method not found',
      data: { kind: 'methodNotFound' },
    })
    expect(
      data.frames.some(
        (row) =>
          row.frame.method === 'session/deleteCompleted' ||
          row.frame.method === 'session/listChanged',
      ),
    ).toBe(false)
  })

  it('captures feedback upload with both disclosures off, and the ephemeral-session refusal separately', () => {
    const data = capture('host-feedback')
    expect(params(data, 'feedback/submit', 'sent')).toEqual({
      classification: 'bug',
      note: 'M106 synthetic protocol capture in an empty throwaway workspace. No private files or session record are consented.',
      withFiles: false,
      attachSessionRecord: false,
    })
    const outcome = z
      .object({
        outcome: z.literal('uploaded'),
        uploadId: z.string().min(1),
        bundlePath: z.string().startsWith('<user-profile>/'),
        sessionRecordAttached: z.literal(false),
        sessionRecordTruncated: z.literal(false),
      })
      .parse(received(data, 5).result)
    expect(outcome.bundlePath).toBe('<user-profile>/.local/share/muse/feedback/feedback-1.md')
    expect(received(capture('session-lifecycle'), 5).error?.data['kind']).toBe('sessionNotFound')
  })

  it('retains the two rejected input probes as counted zero-model evidence', () => {
    const initialization = capture('invalid-initialize')
    expect(received(initialization, 1).error?.data['kind']).toBe('invalidParams')
    expect(received(initialization, 2).error?.data['kind']).toBe('notInitialized')
    expect(received(capture('invalid-approval'), 3).error?.message).toContain(
      'unknown variant `default`',
    )
  })

  it('records the 16-token output minimum as captured refusal evidence', () => {
    // RVCM1062B external blocker: the lead's 2026-10-10 live run refused
    // max_output_tokens: 1. The receipt below is the server's own minimum;
    // the product-side minimum is a separate lane's work (sessionBudget.ts
    // untouched here). A 400 here never becomes capability evidence.
    const receipt = z
      .object({
        ...liveReceipt,
        request: z.object({
          ...liveRequest,
          body: z.object({ max_output_tokens: z.number() }),
        }),
        status: z.literal(400),
        response: z.object({
          error: z.object({
            code: z.null(),
            message: z.string(),
            param: z.literal('max_output_tokens'),
            type: z.literal('invalid_request_error'),
          }),
        }),
      })
      .parse(JSON.parse(readFixture('output-incomplete.json')))
    expect(receipt.request.body.max_output_tokens).toBe(1)
    expect(receipt.response.error.message).toContain('>= 16')
    expect(receipt.provenance.omitted).toContain('encrypted_content')
  })

  it('keeps the raw U9 strict stream as 16 scrubbed frames', () => {
    const receipt = z
      .object({
        ...liveReceipt,
        request: z.object({ ...liveRequest }),
        status: z.literal(200),
        frames: z.array(z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) })),
      })
      .parse(JSON.parse(readFixture('u9-raw-strict-stream.json')))
    expect(receipt.provenance.timestamp).toBe('2026-10-10T20:13:55.176Z')
    expect(receipt.provenance.sourceSha256).toBe(
      'a8c28c39e982020c52b6398fc81ec12e3ce0f74e5a94a21048af43f31d6138f2',
    )
    expect(receipt.frames).toHaveLength(16)
    const types = receipt.frames.map((frame) => frame.data['type'])
    expect(types.filter((type) => type === 'response.function_call_arguments.delta')).toHaveLength(
      2,
    )
    expect(types.at(-1)).toBe('response.completed')
    const bytes = readFixture('u9-raw-strict-stream.json')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'b56095c9e6b467f078079dc92eb4c2a706d8a07498f170e00106efaa45584c42',
    )
  })
})
