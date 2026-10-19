// PR216FIX2 T9: approval routing starts on ACP attach only, so one-shot
// vault commands (which never attach) keep no broker watch and exit when
// done. The listener runs once the first editor attaches, at once when one
// already has, and never again on a later attach (one routing loop: a
// second would ask the editor twice for the same approval).
import { describe, expect, it } from 'vitest'
import { AcpVault } from '../../src/acp/vault'

function neverAsked(): Promise<never> {
  return Promise.reject(new Error('no editor is attached in this test'))
}

describe('AcpVault.onAttach', () => {
  it('runs a listener registered before the first attach', () => {
    const vault = new AcpVault(neverAsked)
    let runs = 0
    vault.onAttach(() => {
      runs += 1
    })
    expect(runs).toBe(0)
    vault.attach(neverAsked)
    expect(vault.attached).toBe(true)
    expect(runs).toBe(1)
  })

  it('runs a listener registered after attach at once', () => {
    const vault = new AcpVault(neverAsked)
    vault.attach(neverAsked)
    let runs = 0
    vault.onAttach(() => {
      runs += 1
    })
    expect(runs).toBe(1)
  })

  it('never re-fires on a later attach', () => {
    const vault = new AcpVault(neverAsked)
    let runs = 0
    vault.onAttach(() => {
      runs += 1
    })
    vault.attach(neverAsked)
    vault.attach(neverAsked)
    expect(runs).toBe(1)
  })
})
