// The paid-grant file store: damaged records fail closed with their cause,
// and an unreadable store never reads as "no grant".
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import { paidGrantFile } from '../../src/runtime/paidGrants'

function logger(lines: string[]): CoreLogger {
  return {
    trace: (message: string) => {
      lines.push(`trace:${message}`)
    },
    info: (message: string) => {
      lines.push(`info:${message}`)
    },
    warn: (message: string) => {
      lines.push(`warn:${message}`)
    },
    error: (message: string) => {
      lines.push(`error:${message}`)
    },
  }
}

function warned(lines: readonly string[]): string[] {
  return lines.filter((line) => line.startsWith('warn:'))
}

function store(directory: string, lines: string[]) {
  return paidGrantFile({
    file: path.join(directory, 'grants.json'),
    log: logger(lines),
    sleep: () => Promise.resolve(),
  })
}

async function removeFolder(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
}

describe('paid-grant file failures', () => {
  it('reads a fresh store as no grants without asking the person anything', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-paid-grants-'))
    try {
      const lines: string[] = []
      const grants = store(directory, lines)
      expect(grants.read('/workspace')).toEqual(new Set())
      expect(grants.quoteNotice()).toBeUndefined()
      expect(lines).toEqual([])
    } finally {
      await removeFolder(directory)
    }
  })

  it('publishes the first generation and reads it back', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-paid-grants-'))
    try {
      const lines: string[] = []
      const grants = store(directory, lines)
      const id = await grants.prepareQuoteGeneration()
      expect(grants.quoteGeneration()).toBe(id)
      expect(lines).toEqual([])
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses a damaged generation record with its cause, never as no grant', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-paid-grants-'))
    try {
      const lines: string[] = []
      const grants = store(directory, lines)
      await grants.prepareQuoteGeneration()
      const generation = path.join(directory, 'grants.json.d', 'webSearch', 'generation.json')
      await writeFile(generation, 'not json', 'utf8')
      let failure: unknown
      try {
        await grants.prepareQuoteGeneration()
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(failure instanceof Error && failure.message).toContain('could not be read')
      expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses an unreadable generation record with its cause', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-paid-grants-'))
    try {
      const lines: string[] = []
      const grants = store(directory, lines)
      await grants.prepareQuoteGeneration()
      const generation = path.join(directory, 'grants.json.d', 'webSearch', 'generation.json')
      await rm(generation)
      await mkdir(generation)
      let failure: unknown
      try {
        await grants.prepareQuoteGeneration()
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(failure instanceof Error && failure.message).toContain('could not be read')
      expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
    } finally {
      await removeFolder(directory)
    }
  })

  it('reads damaged quote storage as no grant and warns with the file, never throwing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-paid-grants-'))
    try {
      const lines: string[] = []
      const grants = store(directory, lines)
      await grants.prepareQuoteGeneration()
      const folder = path.join(directory, 'grants.json.d', 'webSearch')
      await rm(folder, { recursive: true })
      await writeFile(folder, 'not a folder', 'utf8')
      expect(grants.read('/workspace')).toEqual(new Set())
      expect(grants.quoteNotice()).toBeUndefined()
      expect(warned(lines).length).toBeGreaterThan(0)
    } finally {
      await removeFolder(directory)
    }
  })
})
