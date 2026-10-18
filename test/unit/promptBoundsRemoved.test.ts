import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PromptImporter } from '../../src/core/prompts/promptImport'
import { PromptLibrary } from '../../src/core/prompts/promptLibrary'
import { PromptStore, readPromptFile, validatePrompt } from '../../src/core/prompts/promptStore'
import { serialisePromptFile } from '../../src/shared/prompts'
import { savedPromptFixture as fixture } from './helpers/sharingFixtures'

const roots: string[] = []
async function rig() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prompt-no-bounds-'))
  roots.push(root)
  const data = path.join(root, 'data')
  const workspace = path.join(root, 'workspace')
  return { root, data, workspace, store: new PromptStore(data, workspace) }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const identity = { id: () => crypto.randomUUID(), now: () => '2026-10-05T12:00:00Z' }

describe('removed prompt bounds (NOLIMITS1FIX)', () => {
  it('reads a prompt file past the removed 128 KiB bound whole', async () => {
    const { root } = await rig()
    const file = path.join(root, 'large.md')
    await writeFile(file, 'x'.repeat(131_073))
    await expect(readPromptFile(file)).resolves.toBe('x'.repeat(131_073))
  })

  it('previews a portable file past the removed byte cap through a real file read', async () => {
    const { root } = await rig()
    const file = path.join(root, 'large.muse-prompt.md')
    await writeFile(file, serialisePromptFile({ ...fixture, tags: ['x'.repeat(131_073)] }))
    const preview = await new PromptImporter({
      read: (source) => readFile(source.location, 'utf8'),
      isConfidentialWorkspace: () => false,
    }).preview({ kind: 'file', location: file }, 'user')
    expect(preview.prompt.tags).toEqual(['x'.repeat(131_073)])
    expect(preview.prompt.untrusted).toBe(true)
  })

  it('keeps every prompt with no count, title or body ceiling; only blank refuses', async () => {
    const { store, data } = await rig()
    // D121: the removed 80/10000 ceilings refuse nothing.
    expect(() => validatePrompt({ ...fixture, title: 'x'.repeat(81) })).not.toThrow()
    expect(() =>
      validatePrompt({ ...fixture, body: 'x'.repeat(10_001), variables: [] }),
    ).not.toThrow()
    expect(() => validatePrompt({ ...fixture, tags: ['x'.repeat(131_073)] })).not.toThrow()
    expect(() => validatePrompt({ ...fixture, title: ' '.repeat(3) })).toThrow()
    // Seed valid portable files directly, avoiding 199 full-directory scans
    // and fsyncs during fixture construction; the 201st stands (the removed
    // 200-per-scope ceiling refused it).
    await store.write(fixture)
    await Promise.all(
      Array.from({ length: 199 }, (_, index) => {
        const id = `p-${String(index + 1)}`
        return writeFile(
          path.join(data, 'prompts', `${id}.md`),
          serialisePromptFile({ ...fixture, id }),
        )
      }),
    )
    expect(await store.list('user')).toHaveLength(200)
    await new PromptLibrary(store, identity).duplicate(fixture)
    expect(await store.list('user')).toHaveLength(201)
  })
})
