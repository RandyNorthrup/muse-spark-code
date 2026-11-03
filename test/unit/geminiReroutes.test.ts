import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GEMINI_REROUTES,
  applyGeminiReroute,
  resolveGeminiReroute,
} from '../../src/core/providers/geminiReroutes'
import type { NativeModelMetadata } from '../../src/core/providers/modelMetadata'
import { cataloguePriceCard } from '../../src/core/providers/priceCard'
import {
  createConfiguredProviderServices,
  rerouteScanLabel,
} from '../../src/core/providers/configured'

const SNAPSHOT = new URL('../../vendor/models-dev/snapshot.json', import.meta.url)

function geminiSection(): {
  fetchedAt: string
  models: Record<string, NativeModelMetadata>
} {
  // The sealed snapshot, read as JSON data (the sync's own reader owns
  // its validation; these tests pin the reroute join, not the seal).
  const document = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as {
    fetchedAt: string
    providers: Record<string, { models: Record<string, NativeModelMetadata> }>
  }
  return { fetchedAt: document.fetchedAt, models: document.providers['gemini']?.models ?? {} }
}

describe('Gemini reroutes', () => {
  it('cites every reroute with its provider page and read day', () => {
    expect(GEMINI_REROUTES).toHaveLength(4)
    for (const row of GEMINI_REROUTES) {
      expect(row.docUrl).toMatch(/^https:\/\/aistudio\.google\.com\/docs\/changelog#/)
      expect(row.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(row.serves).not.toBe(row.id)
    }
  })

  it('serves already-rerouted ids on any catalogue date', () => {
    expect(resolveGeminiReroute('gemini-3.5-flash', '2026-11-02')).toEqual({
      serves: 'gemini-3.6-flash',
      active: true,
      from: null,
    })
    expect(resolveGeminiReroute('gemini-3.7-flash', undefined)).toEqual({
      serves: 'gemini-3.8-flash',
      active: true,
      from: null,
    })
    expect(resolveGeminiReroute('gemini-3.6-flash', '2026-11-02')).toBeUndefined()
  })

  it('gates dated reroutes on the catalogue date, failing closed without one', () => {
    expect(resolveGeminiReroute('gemini-2.5-pro', '2026-11-02')).toEqual({
      serves: 'gemini-3.8-flash',
      active: false,
      from: '2026-12-01',
    })
    expect(resolveGeminiReroute('gemini-2.5-pro', '2026-12-01')).toMatchObject({ active: true })
    expect(resolveGeminiReroute('gemini-2.5-flash', undefined)).toMatchObject({
      serves: 'gemini-3.5-flash-lite',
      active: false,
    })
  })

  it('answers the serving row while active, none while future', () => {
    // The sealed snapshot (2026-11-02) prices the stale 3.5-flash row at
    // $1.50/$9 against the serving 3.6-flash row at $0.75/$3.75.
    const { fetchedAt, models } = geminiSection()
    const active = applyGeminiReroute(models, 'gemini-3.5-flash', fetchedAt)
    expect(active.row).toMatchObject({ id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' })
    expect(active.reroute).toEqual({
      requested: 'gemini-3.5-flash',
      serves: 'gemini-3.6-flash',
      servesLabel: 'Gemini 3.6 Flash',
      active: true,
    })
    const future = applyGeminiReroute(models, 'gemini-2.5-pro', fetchedAt)
    expect(future.row).toBeUndefined()
    expect(future.reroute).toEqual({
      requested: 'gemini-2.5-pro',
      serves: 'gemini-3.8-flash',
      servesLabel: 'Gemini 3.8 Flash',
      active: false,
      from: '2026-12-01',
    })
    expect(applyGeminiReroute(models, 'gemini-3.6-flash', fetchedAt)).toEqual({
      row: undefined,
      reroute: undefined,
    })
  })

  it('prices an active reroute as the serving model', () => {
    const { models } = geminiSection()
    const { row } = applyGeminiReroute(models, 'gemini-3.5-flash', '2026-11-02')
    const served = cataloguePriceCard('gemini', row?.['cost'])
    const stale = cataloguePriceCard('gemini', models['gemini-3.5-flash']?.['cost'])
    if (served === undefined || stale === undefined) throw new Error('expected priced cards')
    // Cards price per token: the serving row at $0.75/$3.75 per million
    // against the stale requested row at $1.50/$9.
    expect(served.input * 1_000_000).toBeCloseTo(0.75, 9)
    expect(served.output * 1_000_000).toBeCloseTo(3.75, 9)
    expect(stale.input * 1_000_000).toBeCloseTo(1.5, 9)
    expect(stale.output * 1_000_000).toBeCloseTo(9, 9)
  })

  it('lists rerouted ids priced and labelled as the model that serves', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gemini-reroute-'))
    const catalogFile = path.join(directory, 'snapshot.json')
    copyFileSync(SNAPSHOT, catalogFile)
    const configFile = path.join(directory, 'providers.json')
    writeFileSync(
      configFile,
      JSON.stringify({
        v: 1,
        providers: [
          {
            id: 'gemini',
            preset: 'gemini',
            auth: 'apiKey',
            address: 'https://generativelanguage.googleapis.com',
            models: ['gemini-3.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
          },
        ],
      }),
    )
    const services = createConfiguredProviderServices(undefined, {
      configFile,
      catalogFile,
      secrets: { get: () => Promise.resolve(undefined) },
    })
    const models = services.client.models
    if (models?.list === undefined) throw new Error('configured models list missing')
    const rows = await models.list()
    const rerouted = rows.find((row) => row.modelId === 'gemini/gemini-3.5-flash')
    expect(rerouted?.displayLabel).toBe('Gemini 3.6 Flash')
    expect(rerouted?.inputUsdPerMTokens).toBe(0.75)
    expect(rerouted?.outputUsdPerMTokens).toBe(3.75)
    expect(rerouted?.reroute).toEqual({
      requested: 'gemini-3.5-flash',
      serves: 'gemini-3.6-flash',
      servesLabel: 'Gemini 3.6 Flash',
      active: true,
    })
    const future = rows.find((row) => row.modelId === 'gemini/gemini-2.5-pro')
    expect(future?.displayLabel).toBe('Gemini 2.5 Pro')
    expect(future?.inputUsdPerMTokens).toBe(1.25)
    expect(future?.reroute).toEqual({
      requested: 'gemini-2.5-pro',
      serves: 'gemini-3.8-flash',
      servesLabel: 'Gemini 3.8 Flash',
      active: false,
      from: '2026-12-01',
    })
    const lite = rows.find((row) => row.modelId === 'gemini/gemini-2.5-flash')
    expect(lite?.reroute).toMatchObject({
      requested: 'gemini-2.5-flash',
      serves: 'gemini-3.5-flash-lite',
      active: false,
    })
  })

  it('labels scan rows as the serving model with the reroute named', () => {
    expect(
      rerouteScanLabel('gemini-2.5-flash', 'models/gemini-2.5-flash', undefined, undefined),
    ).toBe('models/gemini-2.5-flash')
    expect(
      rerouteScanLabel('gemini-3.5-flash', 'models/gemini-3.5-flash', 'Gemini 3.5 Flash', {
        requested: 'gemini-3.5-flash',
        serves: 'gemini-3.6-flash',
        servesLabel: 'Gemini 3.6 Flash',
        active: true,
      }),
    ).toBe('Gemini 3.6 Flash (gemini-3.5-flash)')
    expect(
      rerouteScanLabel('gemini-2.5-pro', 'models/gemini-2.5-pro', 'Gemini 2.5 Pro', {
        requested: 'gemini-2.5-pro',
        serves: 'gemini-3.8-flash',
        servesLabel: 'Gemini 3.8 Flash',
        active: false,
        from: '2026-12-01',
      }),
    ).toBe('Gemini 2.5 Pro (Routes to Gemini 3.8 Flash on Dec 1, 2026)')
  })
})
