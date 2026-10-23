// M125 lane H: the judged-models table. The shipped table loads with
// its four measured rows and no failures; broken tables fail loud
// and per row, so one bad row never kills the wizard. Scratch files
// only; the shipped file is read, never written.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadJudgeModelsTable } from '../../src/core/judge/setup/table'
import { FIXTURE_HOOK_TIMEOUT_MS } from './helpers/fixtureBudget'

const shipped = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'shared',
  'judgeModels.json',
)

interface ShippedEnvelope {
  readonly rows: Record<string, unknown>[]
  readonly [key: string]: unknown
}

const shippedEnvelope = async (): Promise<ShippedEnvelope> =>
  // Names the shipped table's envelope; the rows below check its shape.
  JSON.parse(await readFile(shipped, 'utf8')) as ShippedEnvelope

describe('judged-models table', () => {
  let scratch = ''

  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'judge-models-'))
  }, FIXTURE_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  })

  const writeTable = async (name: string, text: string): Promise<string> => {
    const file = path.join(scratch, name)
    await writeFile(file, text)
    return file
  }

  it('loads the shipped table with its four measured rows', () => {
    const loaded = loadJudgeModelsTable(shipped, '2026-10-22')
    expect(loaded.failures).toEqual({})
    expect(loaded.table?.version).toBe(1)
    expect(loaded.table?.runtime.version).toBe('0.35.1')
    expect(loaded.table?.runtime.minimum).toBe('0.35.1')
    expect(loaded.table?.runtime.archives).toEqual([])
    expect(loaded.table?.rows.map((row) => row.model)).toEqual([
      'tev1:4b',
      'tev1:0.8b',
      'tev1:0.8b-q8_0',
      'qwen3:4b-instruct-2507-q4_K_M',
    ])
    const rows = loaded.table?.rows ?? []
    for (const row of rows) {
      expect(row.source.length).toBeGreaterThan(0)
      expect(row.checkDate).toBe('2026-10-22')
      // Nothing ships installable-by-accident: digests are captured,
      // timings are raw, families unprofiled.
      for (const latency of row.latency) {
        expect(latency.path).toBe('raw')
      }
      expect(row.profiledFamilies).toEqual([])
    }
  })

  it('fails a row without a source or date and keeps its siblings', async () => {
    const envelope = await shippedEnvelope()
    const broken = { ...envelope.rows[0] }
    delete broken['source']
    delete broken['checkDate']
    const file = await writeTable(
      'mixed.json',
      JSON.stringify({ ...envelope, rows: [broken, envelope.rows[1]] }),
    )
    const loaded = loadJudgeModelsTable(file, '2026-10-22')
    expect(loaded.failures).toEqual({ '<row>': 'invalid-row' })
    expect(loaded.table?.rows.map((row) => row.model)).toEqual(['tev1:0.8b'])
  })

  it('fails insane numbers, future dates and duplicate models per row', async () => {
    const envelope = await shippedEnvelope()
    const first = envelope.rows[0]
    if (first === undefined) throw new Error('shipped table lost its rows')
    const overflow = {
      ...first,
      model: 'overflow:test',
      accuracy: { correct: 41, total: 40, source: 'test' },
    }
    const inverted = {
      ...first,
      model: 'inverted:test',
      latency: [
        { backend: 'cpu', platform: 'linux', p50Ms: 500, p95Ms: 100, path: 'raw', source: 'test' },
      ],
    }
    const future = { ...first, model: 'future:test', checkDate: '2027-01-01' }
    const dupe = { ...first }
    const file = await writeTable(
      'insane.json',
      JSON.stringify({ ...envelope, rows: [overflow, inverted, future, first, dupe] }),
    )
    const loaded = loadJudgeModelsTable(file, '2026-10-22')
    expect(loaded.failures).toEqual({
      'overflow:test': 'accuracy-overflow',
      'inverted:test': 'p50-above-p95',
      'future:test': 'future-date',
      'tev1:4b': 'duplicate-model',
    })
    expect(loaded.table?.rows.map((row) => row.model)).toEqual(['tev1:4b'])
  })

  it('fails broken files loudly and alone', async () => {
    const missing = path.join(scratch, 'nope.json')
    expect(loadJudgeModelsTable(missing, '2026-10-22')).toEqual({
      table: undefined,
      failures: { [missing]: 'missing-file' },
    })
    const garbage = await writeTable('garbage.json', '{nope')
    expect(loadJudgeModelsTable(garbage, '2026-10-22').failures).toEqual({
      [garbage]: 'invalid-json',
    })
    const envelope = await writeTable('envelope.json', JSON.stringify({ version: 2, rows: [] }))
    expect(loadJudgeModelsTable(envelope, '2026-10-22').failures).toEqual({
      [envelope]: 'invalid-schema',
    })
    const shippedEnvelopeValue = await shippedEnvelope()
    const future = await writeTable(
      'future.json',
      JSON.stringify({ ...shippedEnvelopeValue, checkedDate: '2027-01-01' }),
    )
    expect(loadJudgeModelsTable(future, '2026-10-22').failures).toEqual({
      [future]: 'future-date',
    })
  })
})
