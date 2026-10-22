// The usage export bundle (RLUSAGE, PLAN.md D6): the service's export path
// reaches the encoders through their entry, over one completion a real
// recording journaled on a real folder. No doubles of our modules: the
// recording, the store, the service and the encoders are all real.
import { afterEach, describe, expect, it } from 'vitest'
import { usageLocalDay } from '../../src/core/usage/localDay'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText } from '../../src/shared/l10n/usageTable'
import { USAGE_JOURNAL_VERSION } from '../../src/shared/constants'
import { createTestRecording } from './helpers/testRecording'
import { temporaryTracker } from './helpers/temporaryFolders'

const tracker = temporaryTracker()
afterEach(async () => {
  setUiText(EN, 'en')
  setUsageText(USAGE_EN)
  await tracker.cleanup()
})

const MODEL = 'export-entry-model'
const INPUT_TOKENS = 120
const OUTPUT_TOKENS = 34

async function journaledDay(): Promise<{ root: string; day: string }> {
  const root = await tracker.make('usage-export-entry-')
  const warnings: string[] = []
  const at = Date.now()
  const { recording } = createTestRecording(
    {
      root,
      writerId: 'export-entry-writer',
      client: 'test',
      now: () => at,
      newId: () => 'export-entry-1',
    },
    warnings,
  )
  recording.note(
    { input_tokens: INPUT_TOKENS, output_tokens: OUTPUT_TOKENS },
    {
      backend: 'modelApi',
      provider: 'export-entry-provider',
      model: MODEL,
      kind: 'turn',
      pricing: { kind: 'plan' },
      startedAt: at - 1000,
      durationMs: 1000,
      outcome: 'completed',
    },
  )
  await recording.flush()
  expect(warnings).toEqual([])
  return { root, day: usageLocalDay(at) }
}

function accessFor(root: string) {
  return createUsageAccess({
    dataFolder: root,
    packageRoot: process.cwd(),
    host: 'export-entry-test',
    locale: 'en',
    uiText: EN,
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  })
}

describe('usage export entry', () => {
  it('exports the journaled completion as JSON and both CSV shapes', async () => {
    const { root, day } = await journaledDay()
    const access = accessFor(root)
    const query = { range: 'custom', from: day, to: day, groupBy: 'model', metric: 'cost' } as const
    const json = await access.export(query, 'json')
    const parsed = JSON.parse(json) as {
      v: number
      records: { model: string; tokens: { input: number; output: number } }[]
    }
    expect(parsed.v).toBe(USAGE_JOURNAL_VERSION)
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]?.model).toBe(MODEL)
    expect(parsed.records[0]?.tokens.input).toBe(INPUT_TOKENS)
    expect(parsed.records[0]?.tokens.output).toBe(OUTPUT_TOKENS)
    const calls = await access.export(query, 'callsCsv')
    expect(calls.split('\r\n', 1)[0]).toContain('input')
    expect(calls).toContain(`"${MODEL}"`)
    expect(calls).toContain(`"${String(INPUT_TOKENS)}"`)
    const summary = await access.export(query, 'summaryCsv')
    expect(summary.split('\r\n', 1)[0]).toContain('groupBy')
    expect(summary).toContain(MODEL)
  })

  it('refuses a calls export outside the detailed days', async () => {
    const { root } = await journaledDay()
    const access = accessFor(root)
    const replies: unknown[] = []
    const connection = access.connect({
      post: (message) => {
        replies.push(message)
      },
    })
    try {
      await connection.receive({
        type: 'usage/export',
        requestId: 'export-entry-refusal',
        format: 'callsCsv',
        query: {
          range: 'custom',
          from: '2000-01-01',
          to: '2000-01-01',
          groupBy: 'model',
          metric: 'cost',
        },
      })
    } finally {
      connection.dispose()
    }
    expect(replies).toEqual([
      { type: 'usage/error', requestId: 'export-entry-refusal', code: 'exportRange' },
    ])
  })
})
