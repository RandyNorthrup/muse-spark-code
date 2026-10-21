// Tab's ignore-file existence check (src/host/tab/tabIgnoreFile.ts): a
// missing file reads absent, a real file reads present, and a path that
// cannot be proven absent (a file where a folder belongs, a folder the
// check cannot search) reads present, so a broken check denies Tab's read
// instead of widening it or rejecting the completion. Driven by the real
// file system, including a real permission failure.
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { hasIgnoreFile } from '../../src/host/tab/tabIgnoreFile'

const roots: string[] = []
afterAll(() => {
  for (const root of roots) {
    chmodSync(root, 0o755)
    rmSync(root, { recursive: true, force: true })
  }
})

function fresh(): string {
  const root = path.join(tmpdir(), `tab-ignore-file-${String(process.pid)}-${String(roots.length)}`)
  mkdirSync(root, { recursive: true })
  roots.push(root)
  return root
}

describe('hasIgnoreFile', () => {
  it('reads a missing file absent and a real file present', () => {
    const root = fresh()
    expect(hasIgnoreFile(path.join(root, '.gitignore'))).toBe(false)
    writeFileSync(path.join(root, '.gitignore'), '*.log\n')
    expect(hasIgnoreFile(path.join(root, '.gitignore'))).toBe(true)
  })

  it('reads a folder as absent, never present', () => {
    const root = fresh()
    expect(hasIgnoreFile(root)).toBe(false)
  })

  it('reads a path through a file as present: absence is unprovable there', () => {
    const root = fresh()
    const blocker = path.join(root, 'blocker')
    writeFileSync(blocker, 'not a folder')
    expect(hasIgnoreFile(path.join(blocker, '.gitignore'))).toBe(true)
  })

  it('reads an unsearchable folder as present: absence is unprovable there', () => {
    const root = fresh()
    const locked = path.join(root, 'locked')
    mkdirSync(locked)
    writeFileSync(path.join(locked, '.gitignore'), '*.log\n')
    chmodSync(locked, 0o000)
    try {
      expect(hasIgnoreFile(path.join(locked, '.gitignore'))).toBe(true)
    } finally {
      chmodSync(locked, 0o755)
    }
  })
})
