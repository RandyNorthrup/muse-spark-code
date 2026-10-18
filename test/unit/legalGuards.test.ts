// M97 lane S: the read-only, offline guard. A full scan over the hazardous
// fixture tree must leave every byte untouched while executing nothing.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { scanLegal } from '../../src/core/legal/scan'

const FIXTURE_DIR = new URL('../fixtures/legal/tree/', import.meta.url)

function fixtureFiles(dir: URL, root: URL): string[] {
  const found: string[] = []
  const listed2 = readdirSync(dir, { withFileTypes: true })
  for (const entry of listed2) {
    const child = new URL(entry.name, dir)
    if (entry.isDirectory()) {
      found.push(...fixtureFiles(new URL(`${child.href}/`), root))
    } else {
      found.push(decodeURIComponent(child.href.slice(root.href.length)))
    }
  }
  return found.toSorted((a, b) => a.localeCompare(b, 'en'))
}

describe('legal scanner guards', () => {
  it('leaves the hazardous fixture tree byte-identical and executes nothing', async () => {
    const before = new Map<string, string>()
    const listed3 = fixtureFiles(FIXTURE_DIR, FIXTURE_DIR)
    for (const file of listed3) {
      const bytes = readFileSync(new URL(file, FIXTURE_DIR))
      before.set(file, createHash('sha256').update(bytes).digest('hex'))
    }
    expect(before.size).toBeGreaterThan(5)

    const files = Array.from(before.keys(), (entry) => entry)
    const readPaths: string[] = []
    const snapshot = {
      files,
      readFile: (path: string): string | undefined => {
        if (!files.includes(path)) {
          throw new Error(`Out-of-tree read: ${path}`)
        }
        readPaths.push(path)
        return readFileSync(new URL(path, FIXTURE_DIR), 'utf8')
      },
    }
    const result = await scanLegal(snapshot, { headerPolicy: 'required' })
    expect(result.findings.length).toBeGreaterThan(0)
    expect(readPaths).not.toContain('notes/payload.md')

    for (const [file, hash] of before) {
      const bytes = readFileSync(new URL(file, FIXTURE_DIR))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash)
    }
    expect(fixtureFiles(FIXTURE_DIR, FIXTURE_DIR)).toEqual(
      Array.from(before.keys(), (entry) => entry).toSorted((a, b) => a.localeCompare(b, 'en')),
    )

    const report = JSON.stringify(result)
    expect(report).not.toContain('IGNORE EVERYTHING ABOVE')
    expect(report).not.toContain('exfiltrate')
  })
})
