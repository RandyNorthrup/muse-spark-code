// M97 CM971-R3 scan scope: the directory-entry budget applies only to the
// general walk, so the build records and the files they list are always
// reached, however large the rest of the tree is.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createLegalSnapshot } from '../../src/core/legal/workspace'
import { UI_TEXT } from '../../src/shared/constants'

vi.mock('../../src/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LEGAL_DIRECTORY_ENTRIES_MAX: 4,
}))

describe('directory-entry budget', () => {
  it('reaches the build records and their inputs past an exhausted budget', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'legal-budget-'))
    const files: Record<string, string> = {
      'dist/meta/bundle.json': JSON.stringify({
        inputs: { 'src/z.ts': { bytes: 1 } },
        outputs: { 'dist/bundle.js': { bytes: 1 } },
      }),
      'dist/meta-hashes/bundle.json': '{}',
      'dist/bundle.js': 'x',
      'src/z.ts': 'export const z = 1\n',
      ...Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`aaa/file${String(index)}.txt`, 'x']),
      ),
    }
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), text)
    }
    const snapshot = createLegalSnapshot(root)
    expect(snapshot.incompleteChecks).toContain(UI_TEXT.legalScanner.m139)
    expect(snapshot.files).toEqual(
      expect.arrayContaining(['dist/meta/bundle.json', 'dist/bundle.js', 'src/z.ts']),
    )
  })
})
