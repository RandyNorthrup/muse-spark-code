// RLWINFIX item 4: the judge batch's folder removal waits out a
// momentarily held file on Windows instead of failing once, and a removal
// that still fails logs its real error code, never bare `Error`. Real code
// throughout: the real helper over the real filesystem, with the hold made
// by the process's own current directory, which Windows pins.
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { judgeRemovalFailureForLog, removeJudgeTempRoot } from '../../src/host/judge/tempRoot'

describe('judge temp root removal', () => {
  it('removes a real tree, and a gone folder is done', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-judge-root-'))
    await removeJudgeTempRoot(dir)
    await expect(stat(dir)).rejects.toThrow()
    await removeJudgeTempRoot(dir)
  })
})

describe.runIf(process.platform === 'win32')('judge temp root held files', () => {
  it('waits out a hold the process itself releases', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-judge-held-'))
    const previous = process.cwd()
    process.chdir(dir)
    try {
      const removed = removeJudgeTempRoot(dir)
      // The first attempt fails on the pin; the second lands after this.
      await delay(100)
      process.chdir(previous)
      await removed
      await expect(stat(dir)).rejects.toThrow()
    } finally {
      process.chdir(previous)
      await removeJudgeTempRoot(dir)
    }
  })

  it('names a held file by its real code', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-judge-busy-'))
    const previous = process.cwd()
    process.chdir(dir)
    let failure: unknown
    try {
      try {
        await rm(dir, { recursive: true, force: true })
      } catch (error: unknown) {
        failure = error
      }
    } finally {
      process.chdir(previous)
    }
    await removeJudgeTempRoot(dir)
    // The old log line said only this error's name.
    expect(failure).toBeInstanceOf(Error)
    expect(failure instanceof Error ? failure.name : undefined).toBe('Error')
    expect(codeOf(failure)).toMatch(/^(EBUSY|EPERM|EACCES|ENOTEMPTY)$/)
    expect(judgeRemovalFailureForLog(failure)).toBe(codeOf(failure))
  })
})

function codeOf(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  throw new Error('the held-file failure carries no code')
}
