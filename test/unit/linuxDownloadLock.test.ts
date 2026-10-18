import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LinuxDictationModel } from '../../src/core/voice/linuxModel'
import { UI_TEXT } from '../../src/shared/constants'
import { LINUX_DICTATION } from '../../src/shared/linuxDictationConstants'

async function staged(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'pr224fix-lock-'))
  await writeFile(path.join(directory, LINUX_DICTATION.modelFile), 'stale')
  return directory
}

const neverFetch = (): never => {
  throw new Error('no network in the lock test')
}

async function remove(directory: string): Promise<void> {
  await new LinuxDictationModel({ directory, fetch: neverFetch, consent: neverFetch }).remove()
}

describe('Linux download lock recovery', () => {
  it('reclaims an empty lock left by a crash between marker and directory removal', async () => {
    const directory = await staged()
    try {
      await mkdir(path.join(directory, LINUX_DICTATION.lockDirectory))
      await remove(directory)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('still refuses while a live owner holds the lock', async () => {
    const directory = await staged()
    try {
      await mkdir(path.join(directory, LINUX_DICTATION.lockDirectory))
      await writeFile(path.join(directory, LINUX_DICTATION.lockDirectory, String(process.pid)), '')
      await expect(remove(directory)).rejects.toThrow(UI_TEXT.linuxDictationBusy)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('still reclaims a dead owner marker', async () => {
    const directory = await staged()
    const exited = spawnSync(process.execPath, ['--version'])
    expect(exited.status).toBe(0)
    const deadPid = String(exited.pid)
    expect(Number(deadPid)).not.toBe(process.pid)
    try {
      await mkdir(path.join(directory, LINUX_DICTATION.lockDirectory))
      await writeFile(path.join(directory, LINUX_DICTATION.lockDirectory, deadPid), '')
      await remove(directory)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
