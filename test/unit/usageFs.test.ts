// The usage file store: missing entries read as absent, damaged paths
// refuse, and anything else keeps its kind.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'

async function removeFolder(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
}

describe('usage file store', () => {
  it('reads missing entries as absent instead of throwing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-usage-fs-'))
    try {
      const fs = new NodeUsageFs(directory)
      expect(await fs.stat('usage/today.jsonl')).toBeUndefined()
      expect(await fs.list('usage')).toEqual([])
    } finally {
      await removeFolder(directory)
    }
  })

  it('keeps an appended line across a read and removes it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-usage-fs-'))
    try {
      const fs = new NodeUsageFs(directory)
      await fs.append('usage/today.jsonl', '{"day":"today"}\n')
      expect(await fs.stat('usage/today.jsonl')).not.toBeUndefined()
      const bytes = await fs.read('usage/today.jsonl', 0)
      expect(Buffer.from(bytes).toString('utf8')).toBe('{"day":"today"}\n')
      expect(await fs.list('usage')).toEqual(['today.jsonl'])
      await fs.remove('usage/today.jsonl')
      expect(await fs.stat('usage/today.jsonl')).toBeUndefined()
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses a directory read as a file instead of reading it as absent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-usage-fs-'))
    try {
      const fs = new NodeUsageFs(directory)
      await mkdir(path.join(directory, 'usage', 'today.jsonl'), { recursive: true })
      await expect(fs.stat('usage/today.jsonl')).rejects.toThrow()
    } finally {
      await removeFolder(directory)
    }
  })

  it('puts the entry back when the fenced delete is refused', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-usage-fs-'))
    try {
      const fs = new NodeUsageFs(directory)
      await fs.append('usage/today.jsonl', '{"day":"today"}\n')
      const refusal = new Error('settlement refused')
      await expect(fs.remove('usage/today.jsonl', () => Promise.reject(refusal))).rejects.toBe(
        refusal,
      )
      expect(await fs.stat('usage/today.jsonl')).not.toBeUndefined()
      expect(await fs.list('usage')).toEqual(['today.jsonl'])
    } finally {
      await removeFolder(directory)
    }
  })
})
