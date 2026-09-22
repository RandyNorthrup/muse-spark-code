import { describe, expect, it } from 'vitest'
import { type BackendFacts, selectBackend } from '../../src/core/backendSelection'

function facts(overrides: Partial<BackendFacts>): BackendFacts {
  return { setting: 'auto', hasCli: true, hasCliSession: false, hasStoredKey: false, ...overrides }
}

describe('selectBackend', () => {
  it('auto: the CLI session wins, then a stored key, then the gate', () => {
    expect(selectBackend(facts({ hasCliSession: true, hasStoredKey: true }))).toEqual({
      kind: 'museCode',
      status: 'signedIn',
      methods: ['browser', 'apiKey'],
    })
    expect(selectBackend(facts({ hasStoredKey: true }))).toEqual({
      kind: 'modelApi',
      status: 'signedIn',
      methods: ['browser', 'apiKey'],
    })
    expect(selectBackend(facts({}))).toEqual({
      kind: 'museCode',
      status: 'signedOut',
      methods: ['browser', 'apiKey'],
    })
    expect(selectBackend(facts({ hasCli: false }))).toEqual({
      kind: undefined,
      status: 'noCli',
      methods: ['apiKey'],
    })
    expect(selectBackend(facts({ hasCli: false, hasStoredKey: true }))).toEqual({
      kind: 'modelApi',
      status: 'signedIn',
      methods: ['browser', 'apiKey'],
    })
  })

  it('museCode: only the CLI counts, and a stored key never signs it in', () => {
    expect(selectBackend(facts({ setting: 'museCode', hasStoredKey: true }))).toEqual({
      kind: 'museCode',
      status: 'signedOut',
      methods: ['browser'],
    })
    expect(selectBackend(facts({ setting: 'museCode', hasCliSession: true }))).toMatchObject({
      kind: 'museCode',
      status: 'signedIn',
    })
    expect(
      selectBackend(facts({ setting: 'museCode', hasCli: false, hasStoredKey: true })),
    ).toEqual({ kind: undefined, status: 'noCli', methods: [] })
  })

  it('modelApi: only the stored key counts, with or without the CLI', () => {
    expect(selectBackend(facts({ setting: 'modelApi', hasCliSession: true }))).toEqual({
      kind: 'modelApi',
      status: 'signedOut',
      methods: ['apiKey'],
    })
    expect(
      selectBackend(facts({ setting: 'modelApi', hasCli: false, hasStoredKey: true })),
    ).toMatchObject({ kind: 'modelApi', status: 'signedIn' })
  })
})
