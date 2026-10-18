// D119 catch burn-down: a packed ref has no loose file, so only a
// missing loose file falls back to packed-refs. The real file system
// fails for real below. (A full localGitRefs read needs the resource
// governor's git spawn, which this sandbox refuses; the lead runs that
// path outside it.)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { statRefRevision } from '../../src/core/schedules/events/git'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function dir(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'schedule-git-'))
  dirs.push(folder)
  return folder
}

describe('git ref revision source', () => {
  it('reads a loose ref from its own file', async () => {
    const folder = dir()
    const loose = path.join(folder, 'refs', 'heads', 'main')
    mkdirSync(path.dirname(loose), { recursive: true })
    writeFileSync(loose, 'abc123\n', { flag: 'wx' })
    const resolved = await statRefRevision(folder, path.join('refs', 'heads', 'main'))
    expect(resolved.file).toBe(loose)
  })

  it('falls back to packed-refs for a packed ref', async () => {
    const folder = dir()
    const packed = path.join(folder, 'packed-refs')
    writeFileSync(packed, '# pack-refs with: peeled fully-peeled sorted \n')
    const resolved = await statRefRevision(folder, path.join('refs', 'heads', 'main'))
    expect(resolved.file).toBe(packed)
  })

  it('rethrows a non-missing stat failure', async () => {
    const failure = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    await expect(
      statRefRevision(dir(), path.join('refs', 'heads', 'main'), () => Promise.reject(failure)),
    ).rejects.toBe(failure)
  })
})
