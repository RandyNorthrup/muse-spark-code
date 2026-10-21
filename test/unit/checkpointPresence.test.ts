// The presence probe and the archives read
// (src/host/checkpoints/windowPresence.ts,
// src/host/checkpoints/checkpointArchives.ts): the process probe answers
// only what the signal says (gone, exists, or not its to answer); a
// missing archives folder reads as no archives, a malformed file as
// skipped.
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isProcessAlive } from '../../src/host/checkpoints/windowPresence'
import { readArchives, writeArchive } from '../../src/host/checkpoints/checkpointArchives'
import { usingTempDir } from './helpers/temporaryFolders'

describe('isProcessAlive', () => {
  it('answers true for the running process', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('answers true where signalling is not permitted', () => {
    // A process that always exists and that this one may not signal: pid 1
    // (init or launchd) on POSIX, the System process (pid 4) on Windows.
    // EPERM says it exists; success says so too.
    const unsignalled = process.platform === 'win32' ? 4 : 1
    expect(isProcessAlive(unsignalled)).toBe(true)
  })

  it('answers false for a reaped child', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    const pid = child.pid
    if (pid === undefined) {
      throw new Error('the probe child has no pid')
    }
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', () => {
        resolve()
      })
    })
    expect(isProcessAlive(pid)).toBe(false)
  })
})

describe('readArchives', () => {
  it('reads no archives from a missing folder', async () => {
    await usingTempDir('checkpoint-archives-', async (folder) => {
      await expect(readArchives(path.join(folder, 'gone'))).resolves.toEqual([])
    })
  })

  it('skips a malformed archive file', async () => {
    await usingTempDir('checkpoint-archives-', async (folder) => {
      await writeArchive(folder, 'a', { sessionId: 's', at: 1 })
      await mkdir(path.join(folder, 'archives'), { recursive: true })
      await writeFile(path.join(folder, 'archives', 'b.json'), '{nope')
      const archives = await readArchives(folder)
      expect(archives.map((archive) => archive.archive.sessionId)).toEqual(['s'])
    })
  })
})
