import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptStore, readPromptFile, validatePrompt } from '../../src/core/prompts/promptStore'
import { filterPrompts } from '../../src/core/prompts/promptSearch'
import { PromptLibrary, usePrompt } from '../../src/core/prompts/promptLibrary'
import { promptDraftSchema } from '../../src/core/prompts/promptTypes'
import { serialisePromptFile } from '../../src/shared/prompts'
import { savedPromptFixture as fixture } from './helpers/sharingFixtures'

const roots: string[] = []
async function rig() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prompt-store-'))
  roots.push(root)
  const data = path.join(root, 'data')
  const a = path.join(root, 'a')
  const b = path.join(root, 'b')
  await mkdir(a)
  await mkdir(b)
  return { root, data, a, b, store: new PromptStore(data, a) }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const identity = { id: () => crypto.randomUUID(), now: () => '2026-10-05T12:00:00Z' }

describe('portable prompt store and library', () => {
  it('validates editable fields and strips caller-owned trust and identities', async () => {
    const { store } = await rig()
    const library = new PromptLibrary(store, identity)
    const draft = { title: 'Good', body: 'Plain', tags: ['review'], scope: 'user' as const }
    for (const invalid of [
      { ...draft, title: ' ' },
      { ...draft, title: 'x'.repeat(81) },
      { ...draft, body: 'x'.repeat(10_001) },
      { ...draft, tags: [''] },
      { ...draft, tags: [1] },
      { ...draft, scope: 'remote' },
    ])
      expect(promptDraftSchema.safeParse(invalid).success).toBe(false)
    const callerDraft = { ...draft, id: 'caller', untrusted: true }
    expect(promptDraftSchema.parse(callerDraft)).toEqual(draft)
    const prepared = library.prepare(callerDraft)
    expect(prepared.id).not.toBe('caller')
    expect(prepared.untrusted).toBe(false)
    expect(await store.list('user')).toEqual([])
  })
  it('round trips exact Markdown and shows both scopes in any workspace', async () => {
    const { store, data, b } = await rig()
    const prompt = { ...fixture, body: fixture.body.replaceAll('\n', '\r\n') }
    await store.write(prompt)
    await store.write({ ...prompt, scope: 'workspace' })
    expect(await store.library()).toEqual([prompt, { ...prompt, scope: 'workspace' }])
    expect(await new PromptStore(data, b).library()).toEqual([prompt])
    expect(await new PromptStore(data).library()).toEqual([prompt])
    const library = new PromptLibrary(store, identity)
    const copy = await library.duplicate({ ...prompt, scope: 'workspace', untrusted: true }, 'user')
    expect(copy.id).not.toBe(prompt.id)
    expect(copy.untrusted).toBe(true)
    expect(await store.list('workspace')).toHaveLength(1)
    expect(filterPrompts(await store.library(), 'selection', 'review')).toHaveLength(3)
  })
  it('retains damaged files and refuses every mutation', async () => {
    const { store, data } = await rig()
    await store.write(fixture)
    const directory = path.join(data, 'prompts')
    await writeFile(path.join(directory, 'broken.md'), 'invalid front matter')
    const before = await readFile(path.join(directory, 'broken.md'))
    await expect(store.list('user')).rejects.toThrow('damaged')
    await expect(store.write({ ...fixture, title: 'Changed' })).rejects.toThrow()
    await expect(store.remove('user', fixture.id)).rejects.toThrow()
    expect(await readFile(path.join(directory, 'broken.md'))).toEqual(before)
  })
  it('rejects conflicting ids, wrong scopes, symlinks and overlarge files', async () => {
    const { store, data, root } = await rig()
    await store.write(fixture)
    const directory = path.join(data, 'prompts')
    const conflict = path.join(directory, 'second.md')
    await writeFile(conflict, serialisePromptFile(fixture))
    await expect(store.list('user')).rejects.toThrow()
    await writeFile(
      conflict,
      serialisePromptFile({ ...fixture, id: 'wrong-scope', scope: 'workspace' }),
    )
    await expect(store.list('user')).rejects.toThrow()
    await rm(conflict)
    const names = await readdir(directory)
    await symlink(path.join(directory, names[0]!), conflict)
    await expect(store.list('user')).rejects.toThrow()
    await expect(readPromptFile(conflict)).rejects.toThrow()
    await rm(conflict)
    await writeFile(conflict, 'x'.repeat(131_073))
    await expect(readPromptFile(conflict)).rejects.toThrow()
    await rm(conflict)
    await rm(directory, { recursive: true })
    await symlink(root, directory)
    await expect(store.write(fixture)).rejects.toThrow()
  })
  it('enforces title/body/count limits and preserves untrusted status on edit', async () => {
    const { store } = await rig()
    expect(() => validatePrompt({ ...fixture, title: 'x'.repeat(81) })).toThrow()
    expect(() => validatePrompt({ ...fixture, title: ' '.repeat(3) })).toThrow()
    expect(() => validatePrompt({ ...fixture, tags: ['x'.repeat(131_073)] })).toThrow()
    expect(() => validatePrompt({ ...fixture, body: 'x'.repeat(10_001), variables: [] })).toThrow()
    const library = new PromptLibrary(store, identity)
    await store.write({ ...fixture, untrusted: true })
    await store.write(fixture)
    expect(await store.list('user')).toEqual([expect.objectContaining({ untrusted: true })])
    await library.save(
      { title: 'Edited', body: 'Plain', tags: [], scope: 'user' },
      { ...fixture, untrusted: true },
    )
    expect(await store.list('user')).toEqual([expect.objectContaining({ untrusted: true })])
    for (let i = 1; i < 200; i++) await store.write({ ...fixture, id: `p-${String(i)}` })
    await expect(library.duplicate(fixture)).rejects.toThrow()
    await library.remove(fixture)
    expect(await store.list('user')).toHaveLength(199)
  })
  it('refuses a concurrent writer and preserves the lock', async () => {
    const { store, data } = await rig()
    await store.write(fixture)
    const lock = path.join(data, 'prompts', '.write-lock')
    await writeFile(lock, 'held')
    await expect(store.write(fixture)).rejects.toThrow('busy')
    expect(await readFile(lock, 'utf8')).toBe('held')
  })
  it('syncs only user scope, newest wins, and validates before any writes', async () => {
    const { store } = await rig()
    await store.write(fixture)
    await store.write({ ...fixture, scope: 'workspace' })
    const newer = { ...fixture, title: 'Newer', untrusted: true, updatedAt: '2026-10-05T12:00:00Z' }
    let mirror: unknown = [newer]
    const write = vi.fn((_prompts: readonly (typeof fixture)[]) => Promise.resolve())
    const sync = { isOn: () => true, read: () => mirror, write }
    const library = new PromptLibrary(store, identity, sync)
    await library.synchronise()
    expect(await store.list('user')).toEqual([newer])
    expect(write.mock.calls[0]?.[0]).toEqual([newer])
    mirror = [newer, { ...fixture, id: 'wrong-scope', scope: 'workspace' }]
    await expect(library.synchronise()).rejects.toThrow()
    expect(await store.list('user')).toEqual([newer])
    mirror = [newer, newer]
    await expect(library.synchronise()).rejects.toThrow()
    const off = vi.fn()
    await new PromptLibrary(store, identity, {
      ...sync,
      isOn: () => false,
      read: off,
    }).synchronise()
    expect(off).not.toHaveBeenCalled()
    const imported = await library.import(fixture)
    expect(imported.id).not.toBe(fixture.id)
    expect(imported.untrusted).toBe(true)
  })
})

describe('insert-only variable review', () => {
  it('reviews all sources and expanded text before inserting, without recursive substitution', async () => {
    const calls: string[] = []
    const port = {
      valueFor: vi.fn((v: { name: string }) => {
        calls.push(v.name)
        return Promise.resolve(v.name === 'selection' ? '{{audience}}' : '$&')
      }),
      review: vi.fn((text: string) => {
        calls.push('review')
        expect(text).toContain('{{audience}}')
        return Promise.resolve(true)
      }),
      insert: vi.fn(() => {
        calls.push('insert')
        return Promise.resolve()
      }),
    }
    expect(await usePrompt(fixture, port)).toBe('inserted')
    expect(calls).toEqual(['selection', 'file', 'clipboard', 'audience', 'review', 'insert'])
    expect(port.insert.mock.calls).toHaveLength(1)
  })
  it('cancelled variables/review and oversized expansion never insert', async () => {
    const insert = vi.fn(() => Promise.resolve())
    await usePrompt(fixture, {
      valueFor: () => Promise.resolve(undefined),
      review: () => Promise.resolve(true),
      insert,
    })
    await usePrompt(fixture, {
      valueFor: () => Promise.resolve('ok'),
      review: () => Promise.resolve(false),
      insert,
    })
    await expect(
      usePrompt(fixture, {
        valueFor: () => Promise.resolve('x'.repeat(10_001)),
        review: () => Promise.resolve(true),
        insert,
      }),
    ).rejects.toThrow()
    expect(insert).not.toHaveBeenCalled()
  })
})
