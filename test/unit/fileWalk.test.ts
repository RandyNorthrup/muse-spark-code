import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { walkFiles } from '../../src/runtime/fileWalk'

function collectingLog(lines: string[]): Logger {
  return {
    trace: (message) => {
      lines.push(`trace:${message}`)
    },
    info: (message) => {
      lines.push(`info:${message}`)
    },
    warn: (message) => {
      lines.push(`warn:${message}`)
    },
    error: (message) => {
      lines.push(`error:${message}`)
    },
  }
}

describe('fileWalk unreadable folders', () => {
  it('lists real files with forward slashes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'file-walk-'))
    try {
      mkdirSync(path.join(root, 'sub'))
      writeFileSync(path.join(root, 'a.txt'), 'a')
      writeFileSync(path.join(root, 'sub', 'b.txt'), 'b')
      expect(await walkFiles(root, 100, collectingLog([]))).toEqual(['a.txt', 'sub/b.txt'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('names the errno when a folder cannot be listed, and keeps walking', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'file-walk-'))
    try {
      // A real readdir failure: the root itself is a file, so the native
      // directory read fails with ENOTDIR on every platform.
      const file = path.join(root, 'not-a-folder.txt')
      writeFileSync(file, 'x')
      const lines: string[] = []
      expect(await walkFiles(file, 100, collectingLog(lines))).toEqual([])
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('Could not list')
      expect(lines[0]).toContain('ENOTDIR')
      expect(lines[0]).not.toContain('Error:')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
