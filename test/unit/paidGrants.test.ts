// The paid-grant file store: damaged records fail closed with their cause,
// and an unreadable store never reads as "no grant".
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { usingTempDir } from './helpers/temporaryFolders'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import type { PaidGrantStore } from '../../src/acp/paid'

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

function generationStore(directory: string, lines: string[]) {
  return {
    grants: store(directory, lines),
    generation: path.join(directory, 'grants.json.d', 'webSearch', 'generation.json'),
  }
}

async function refusesDamagedGeneration(grants: PaidGrantStore, damage: () => Promise<void>) {
  await quotes(grants).prepareQuoteGeneration()
  await damage()
  let failure: unknown
  try {
    await quotes(grants).prepareQuoteGeneration()
  } catch (error: unknown) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect(failure instanceof Error && failure.message).toContain('could not be read')
  expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
}

function quotes(grants: PaidGrantStore) {
  const prepareQuoteGeneration = grants.prepareQuoteGeneration
  const quoteGeneration = grants.quoteGeneration
  const quoteNotice = grants.quoteNotice
  if (
    prepareQuoteGeneration === undefined ||
    quoteGeneration === undefined ||
    quoteNotice === undefined
  )
    throw new Error('quote methods unavailable')
  return { prepareQuoteGeneration, quoteGeneration, quoteNotice }
}

describe('paid-grant file failures', () => {
  it('reads a fresh store as no grants without asking the person anything', async () => {
    await usingTempDir('muse-paid-grants-', (directory) => {
      const lines: string[] = []
      const grants = store(directory, lines)
      expect(grants.read('/workspace')).toEqual(new Set())
      expect(quotes(grants).quoteNotice()).toBeUndefined()
      expect(lines).toEqual([])
    })
  })

  it('publishes the first generation and reads it back', async () => {
    await usingTempDir('muse-paid-grants-', async (directory) => {
      const lines: string[] = []
      const grants = store(directory, lines)
      const id = await quotes(grants).prepareQuoteGeneration()
      expect(quotes(grants).quoteGeneration()).toBe(id)
      expect(lines).toEqual([])
    })
  })

  it('refuses a damaged generation record with its cause, never as no grant', async () => {
    await usingTempDir('muse-paid-grants-', async (directory) => {
      const lines: string[] = []
      const { grants, generation } = generationStore(directory, lines)
      await refusesDamagedGeneration(grants, () => writeFile(generation, 'not json', 'utf8'))
    })
  })

  it('refuses an unreadable generation record with its cause', async () => {
    await usingTempDir('muse-paid-grants-', async (directory) => {
      const lines: string[] = []
      const { grants, generation } = generationStore(directory, lines)
      await refusesDamagedGeneration(grants, async () => {
        await rm(generation)
        await mkdir(generation)
      })
    })
  })

  it('reads damaged quote storage as no grant and warns with the file, never throwing', async () => {
    await usingTempDir('muse-paid-grants-', async (directory) => {
      const lines: string[] = []
      const grants = store(directory, lines)
      await quotes(grants).prepareQuoteGeneration()
      const folder = path.join(directory, 'grants.json.d', 'webSearch')
      await rm(folder, { recursive: true })
      await writeFile(folder, 'not a folder', 'utf8')
      expect(grants.read('/workspace')).toEqual(new Set())
      expect(quotes(grants).quoteNotice()).toBeUndefined()
      expect(warned(lines).length).toBeGreaterThan(0)
    })
  })
})
