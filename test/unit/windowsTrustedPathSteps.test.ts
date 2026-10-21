// Safer Windows paths (TRUSTROOT, D105): the trusted root's component walk,
// through the real verifier module. A name that merely starts with two dots
// (`..foo`) is an ordinary folder, not an escape: only `..` itself or a
// leading `..\` leaves the root. No subprocess or file system is touched:
// every refusal below happens before any query.

import { describe, expect, it } from 'vitest'
import { stepsBelow, windowsTrustedPathVerifier } from '../../src/runtime/windowsTrustedPath'

const neverRun = (): Promise<{ exitCode: number; stdout: string }> => {
  throw new Error('no subprocess may run for a pre-query refusal')
}

describe('stepsBelow', () => {
  it('accepts the root itself and names below it in order', () => {
    expect(stepsBelow(String.raw`C:\root`, String.raw`C:\root`)).toEqual([])
    expect(stepsBelow(String.raw`C:\root`, String.raw`C:\root\sub\leaf.txt`)).toEqual([
      'sub',
      'leaf.txt',
    ])
  })

  it('accepts ordinary names that start with two dots', () => {
    expect(stepsBelow(String.raw`C:\root`, String.raw`C:\root\..foo`)).toEqual(['..foo'])
    expect(stepsBelow(String.raw`C:\root`, String.raw`C:\root\...`)).toEqual(['...'])
    expect(stepsBelow(String.raw`C:\root`, String.raw`C:\root\sub\..foo`)).toEqual(['sub', '..foo'])
  })

  it('refuses genuine escapes: the parent, a sibling, another drive', () => {
    expect(stepsBelow(String.raw`C:\root`, String.raw`C:\root\..\other`)).toBeUndefined()
    expect(stepsBelow(String.raw`C:\root`, String.raw`C:\other`)).toBeUndefined()
    expect(stepsBelow(String.raw`C:\root`, String.raw`D:\root\leaf.txt`)).toBeUndefined()
  })
})

describe('windowsTrustedPathVerifier pre-query refusals', () => {
  it('still fails closed when the leaf escapes its trusted root', async () => {
    const verifier = windowsTrustedPathVerifier(neverRun)
    const result = await verifier.verify(String.raw`C:\root\..\other\leaf.txt`, {
      leafKind: 'file',
      root: String.raw`C:\root`,
    })
    expect(result).toEqual({
      refused: true,
      component: String.raw`C:\root\..\other\leaf.txt`,
      reason: 'outside its trusted root',
    })
  })

  it('requires absolute paths', async () => {
    const verifier = windowsTrustedPathVerifier(neverRun)
    const relative = await verifier.verify(String.raw`root\leaf.txt`, { leafKind: 'file' })
    expect(relative).toMatchObject({ refused: true, reason: 'absolute path required' })
    const badRoot = await verifier.verify(String.raw`C:\root\leaf.txt`, {
      leafKind: 'file',
      root: 'root',
    })
    expect(badRoot).toMatchObject({ refused: true, reason: 'absolute root required' })
  })
})
