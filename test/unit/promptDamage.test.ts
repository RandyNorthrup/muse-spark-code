import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { PromptLibrary } from '../../src/core/prompts/promptLibrary'
import { PromptStore } from '../../src/core/prompts/promptStore'
import { savedPromptFixture } from './helpers/sharingFixtures'

const roots: string[] = []
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'muse-prompt-damage-'))
  roots.push(root)
  return root
}

describe('prompt store damage', () => {
  it('reads a scope blocked by a file as damaged, carrying the failure', async () => {
    const data = await freshRoot()
    // A file where the prompts directory belongs: the scope cannot open.
    await writeFile(path.join(data, 'prompts'), 'in the way', 'utf8')
    const store = new PromptStore(data)
    let failure: unknown
    try {
      await store.list('user')
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.promptStoreDamaged)
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })

  it('marks only the damaged scope, and the healthy scope still loads', async () => {
    const data = await freshRoot()
    const workspace = await freshRoot()
    await writeFile(path.join(data, 'prompts'), 'in the way', 'utf8')
    const store = new PromptStore(data, workspace)
    let nextId = 0
    await store.write({
      ...savedPromptFixture,
      id: 'workspace-prompt',
      scope: 'workspace',
    })
    const library = new PromptLibrary(
      store,
      { id: () => `prompt-${String(nextId++)}`, now: () => '2026-10-18T00:00:00Z' },
      undefined,
    )
    const result = await library.list(true)
    expect(result.scopes.find((scope) => scope.scope === 'user')?.damaged).toBe(true)
    expect(result.scopes.find((scope) => scope.scope === 'workspace')).toMatchObject({
      damaged: false,
    })
    expect(result.prompts.map((prompt) => prompt.id)).toEqual(['workspace-prompt'])
  })

  it('reads a held lock as busy, carrying the take failure', async () => {
    const data = await freshRoot()
    const store = new PromptStore(data)
    await store.write({ ...savedPromptFixture, id: 'first' })
    // Another window's lock, left on disk: the take fails with EEXIST.
    await writeFile(path.join(data, 'prompts', '.write-lock'), 'held', 'utf8')
    let failure: unknown
    try {
      await store.write({ ...savedPromptFixture, id: 'second' })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.promptStoreBusy)
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })
})
