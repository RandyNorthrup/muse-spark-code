// The state seal's failure rules over the real filesystem: a missing file
// marks absent, and a link whose target cannot be sampled marks the pair.
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSealIntact, sealOf } from '../../src/runtime/panel/git/transaction'

describe('sealOf failure marks', () => {
  it('marks a missing file absent and keeps a sampled file intact', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'git-seal-'))
    try {
      const present = path.join(root, 'present.txt')
      writeFileSync(present, 'x')
      const seal = sealOf([present, path.join(root, 'missing.txt')])
      expect(seal.marks).toHaveLength(2)
      expect(seal.marks[1]).toBe('absent')
      expect(isSealIntact(seal)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')('marks a link with an unsampleable target', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'git-seal-'))
    try {
      const link = path.join(root, 'dangling.txt')
      symlinkSync(path.join(root, 'no-target.txt'), link)
      const seal = sealOf([link])
      expect(seal.marks).toHaveLength(1)
      const [first] = seal.marks
      if (first === undefined) throw new Error('the seal has no mark')
      expect(first).not.toBe('absent')
      const pair: unknown = JSON.parse(first)
      expect(Array.isArray(pair)).toBe(true)
      if (!Array.isArray(pair)) throw new Error('unreachable')
      expect(pair[1]).toBe('absent')
      expect(isSealIntact(seal)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
