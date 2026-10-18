// The approved save's generation recheck (Codex on PR #227): the store
// recomputes the library generation under its write lock, so a save the
// library moved under throws instead of landing. Real store, real files.
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryGeneration } from '../../src/core/connector/tools/prompts'
import { PromptLibraryStaleError, PromptStore } from '../../src/core/prompts/promptStore'
import type { SavedPrompt } from '../../src/shared/prompts'
import { savedPromptFixture } from './helpers/sharingFixtures'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
})

async function store(): Promise<{ data: string; prompts: PromptStore }> {
  const data = await mkdtemp(path.join(os.tmpdir(), 'm124-stale-'))
  folders.push(data)
  return { data, prompts: new PromptStore(data, undefined) }
}

function named(id: string, updatedAt: string): SavedPrompt {
  return { ...savedPromptFixture, id, createdAt: updatedAt, updatedAt }
}

describe('prompt store generation recheck', () => {
  it('lands a save naming the live generation and refuses one naming a moved one', async () => {
    const { prompts } = await store()
    // Two approved saves read the same empty library; the first lands.
    await prompts.write(named('prompt-a', '2026-10-09T12:00:00.000Z'), false, 0)
    // The second names the generation it read (0): the library moved under
    // it, so nothing lands and the writer learns it is stale.
    await expect(
      prompts.write(named('prompt-b', '2026-10-09T12:00:01.000Z'), false, 0),
    ).rejects.toBeInstanceOf(PromptLibraryStaleError)
    const landed = await prompts.list('user')
    expect(landed.map((prompt) => prompt.id)).toEqual(['prompt-a'])
    // Naming the live generation lands.
    const live = libraryGeneration(landed)
    await prompts.write(named('prompt-b', '2026-10-09T12:00:01.000Z'), false, live)
    const both = await prompts.list('user')
    expect(
      both.map((prompt) => prompt.id).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(['prompt-a', 'prompt-b'])
  })

  it('writes without a recheck when no generation is named', async () => {
    const { prompts } = await store()
    await prompts.write(named('prompt-a', '2026-10-09T12:00:00.000Z'))
    const landed = await prompts.list('user')
    expect(landed.map((prompt) => prompt.id)).toEqual(['prompt-a'])
  })
})
