import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PRESETS } from '../../src/core/providers/presets'
import { MSP_KNOWN_SCHEMA_FINGERPRINTS } from '../../src/shared/constants'

const record = z.record(z.string(), z.unknown())
const error = z.object({ code: z.number(), message: z.string(), data: record })
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
  frames: z.array(
    z.object({
      direction: z.enum(['sent', 'received']),
      frame: z.object({
        jsonrpc: z.literal('2.0'),
        id: z.number().optional(),
        method: z.string().optional(),
        params: record.optional(),
        result: record.optional(),
        error: error.optional(),
      }),
    }),
  ),
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
const manifestSchema = z.object({
  totals: z.object({
    processLaunches: z.number(),
    mspRequestAttempts: z.number(),
    turnStartAttempts: z.literal(0),
    modelAttempts: z.literal(0),
    feedbackSubmitAttempts: z.number(),
    feedbackUploads: z.number(),
    metaCollectorHttpAttempts: z.literal(0),
  }),
  captures: z.array(
    z.object({
      file: z.string(),
      sha256: z.string(),
      sourceSha256: z.string(),
      requestAttempts: z.number(),
      modelAttempts: z.literal(0),
    }),
  ),
  providers: z.array(
    z.object({
      provider: z.string(),
      state: z.literal('waiting'),
      requires: z.string().min(1),
      items: z.array(z.string()),
      newAttempts: z.literal(0),
      reason: z.string().min(1),
    }),
  ),
})
function manifest() {
  const value: unknown = JSON.parse(readFixture('completion-manifest.json'))
  return manifestSchema.parse(value)
}

describe('C-M106-1 counted Muse Code 1.4.4 captures', () => {
  it('validates scrubbed fixture hashes and counts every launched probe and request once', () => {
    const receipt = manifest()
    let attempts = 0
    for (const source of receipt.captures) {
      expect(source.file).toMatch(/^msp-1\.4\.4-[a-z-]+\.json$/)
      const bytes = readFixture(source.file)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256)
      const data = captureSchema.parse(JSON.parse(bytes))
      expect(data.provenance.sourceSha256).toBe(source.sourceSha256)
      expect(data.provenance.requestAttempts).toBe(source.requestAttempts)
      const requests = data.frames.filter(
        (row) => row.direction === 'sent' && row.frame.id !== undefined,
      )
      expect(requests).toHaveLength(source.requestAttempts)
      expect(requests.every((row) => row.frame.method !== 'turn/start')).toBe(true)
      expect(data.provenance.launchArguments).toEqual([
        'serve',
        '--provider',
        'meta',
        '--model',
        'muse-spark-1.3-contributor',
        '--no-session-log',
        '--disable-shell',
        '--disable-write',
      ])
      const frames = JSON.stringify(data.frames)
      expect(frames).not.toMatch(
        /"(?:museHome|profileId|avatarUrl|email|encrypted_content|encryptedContent)"/,
      )
      expect(frames.replaceAll('\\\\', '/')).not.toMatch(/(?:\/Users\/|[A-Za-z]:\/Users\/)/)
      attempts += source.requestAttempts
    }
    expect(receipt.totals).toMatchObject({
      processLaunches: 4,
      mspRequestAttempts: attempts,
      modelAttempts: 0,
      feedbackSubmitAttempts: 2,
      feedbackUploads: 1,
    })
    expect(attempts).toBe(18)
  })

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

  it('names every provider credential or local runtime still waiting without granting capabilities', () => {
    const rows = manifest().providers
    expect(rows.map((row) => row.provider).toSorted((a, b) => a.localeCompare(b))).toEqual(
      ['meta', ...PRESETS.map((preset) => preset.id)].toSorted((a, b) => a.localeCompare(b)),
    )
    expect(rows.every((row) => row.requires.length > 0)).toBe(true)
    expect(
      rows.every((row) => row.items.includes('streaming') && row.items.includes('headers')),
    ).toBe(true)
    expect(rows.find((row) => row.provider === 'openai')?.requires).toBe('OPENAI_API_KEY')
    expect(rows.find((row) => row.provider === 'meta')?.requires).toBe(
      'Meta Model API key (lead-held)',
    )
  })
})
