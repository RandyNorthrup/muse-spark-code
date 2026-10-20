// The legal workspace snapshot's unreadable entries (D119): a refused path
// and a shaped store failure each mark the entry incomplete in fixed words
// while the rest of the tree still reads; undecodable bytes read absent.
// The locked folder is a real permission failure on every platform
// (helpers/deniedAccess: chmod 0 on POSIX, a deny entry on Windows).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLegalSnapshot } from '../../src/core/legal/workspace'
import { denyAccess } from './helpers/deniedAccess'

const roots: { root: string; restore: () => Promise<void> }[] = []
afterEach(async () => {
  for (const { root, restore } of roots.splice(0)) {
    await restore()
    rmSync(root, { recursive: true, force: true })
  }
})

async function plant(refusedName: string | undefined): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-legal-snapshot-'))
  writeFileSync(path.join(root, 'note.txt'), 'hello')
  writeFileSync(path.join(root, 'bad.bin'), Buffer.from([0xff, 0xfe]))
  mkdirSync(path.join(root, 'locked'))
  writeFileSync(path.join(root, 'locked', 'secret.txt'), 'secret')
  if (refusedName !== undefined) writeFileSync(path.join(root, refusedName), 'refused')
  roots.push({ root, restore: await denyAccess(path.join(root, 'locked')) })
  return root
}

describe('legal workspace snapshot unreadable entries', () => {
  it('reads the admitted files and marks the locked directory incomplete', async () => {
    const root = await plant(undefined)
    const snapshot = await createLegalSnapshot(root)
    expect(snapshot.readFile('note.txt')).toBe('hello')
    expect(snapshot.readFileHash?.('note.txt')).toMatch(/^[0-9a-f]+$/)
    expect(snapshot.incompleteChecks.some((entry) => entry.includes('locked'))).toBe(true)
    expect(
      snapshot.incompleteChecks
        .filter((entry) => entry.includes('locked'))
        .every((entry) => entry.includes('could not be admitted')),
    ).toBe(true)
  })

  it('reads undecodable bytes absent', async () => {
    const root = await plant(undefined)
    const snapshot = await createLegalSnapshot(root)
    expect(snapshot.readFile('bad.bin')).toBe(undefined)
  })

  it.skipIf(process.platform === 'win32')(
    'marks a refused path incomplete in the same words',
    async () => {
      const root = await plant('a:b')
      const snapshot = await createLegalSnapshot(root)
      expect(
        snapshot.incompleteChecks.some(
          (entry) => entry.includes('a:b') && entry.includes('could not be admitted'),
        ),
      ).toBe(true)
      expect(snapshot.readFile('note.txt')).toBe('hello')
    },
  )
})
