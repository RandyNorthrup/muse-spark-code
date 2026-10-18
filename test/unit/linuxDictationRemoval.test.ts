import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeLinuxDictationModel } from '../../src/host/voice/voiceLinuxEntry'
import { LINUX_DICTATION } from '../../src/shared/linuxDictationConstants'

describe('Linux dictation cleanup', () => {
  it('removes the directory itself once its managed files are gone', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pr224fix-cleanup-'))
    const directory = path.join(root, LINUX_DICTATION.directory)
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, LINUX_DICTATION.modelFile), 'stale')
      await writeFile(path.join(directory, LINUX_DICTATION.partialFile), 'stale')
      await removeLinuxDictationModel(directory)
      expect(existsSync(directory)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('tolerates a directory that is already gone', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pr224fix-cleanup-'))
    try {
      await removeLinuxDictationModel(path.join(root, LINUX_DICTATION.directory))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails loudly while an unmanaged file keeps the directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pr224fix-cleanup-'))
    const directory = path.join(root, LINUX_DICTATION.directory)
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, 'user-note.txt'), 'not ours')
      await expect(removeLinuxDictationModel(directory)).rejects.toThrow()
      expect(existsSync(directory)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
