// M88 lane A: the sequence file store against the real filesystem. One
// JSON file per sequence under its scope's `sequences/` folder; blanks
// refuse in words, a damaged scope refuses in fixed words, and a held
// lock says the store is busy.
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SequenceStore, validateSequenceInput } from '../../src/core/prompts/sequenceStore'
import { PROMPT_USER_FOLDER, SEQUENCE_SUBFOLDER, UI_TEXT } from '../../src/shared/constants'
import type { SavedSequence } from '../../src/shared/sequences'
import { sequence } from './helpers/sequenceFixtures'
import { removeFolder } from './helpers/temporaryFolders'

describe('sequence store', () => {
  let dataFolder = ''
  let workspaceRoot = ''

  beforeEach(async () => {
    dataFolder = await mkdtemp(path.join(tmpdir(), 'muse-sequence-store-'))
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'muse-sequence-workspace-'))
  })
  afterEach(async () => {
    await removeFolder(dataFolder)
    await removeFolder(workspaceRoot)
  })

  it('saves and lists both scopes, user first', async () => {
    const store = new SequenceStore(dataFolder, workspaceRoot)
    await store.save(sequence({ id: 'b', name: 'Beta' }))
    await store.save(sequence({ id: 'a', name: 'Alpha' }))
    await store.save(sequence({ id: 'w', name: 'Workspace', scope: 'workspace' }))
    const library = await store.library()
    expect(library.map((row) => `${row.scope}:${row.name}`)).toEqual([
      'user:Alpha',
      'user:Beta',
      'workspace:Workspace',
    ])
    // One JSON file per sequence under the scope's sequences folder.
    const folder = path.join(dataFolder, PROMPT_USER_FOLDER, SEQUENCE_SUBFOLDER)
    const files = await libraryFiles(dataFolder)
    const names: string[] = []
    for (const file of files) {
      // The cast names the file shape this test's own save wrote, for the name assertion.
      const saved = JSON.parse(await readFile(path.join(folder, file), 'utf8')) as SavedSequence
      names.push(saved.name)
    }
    expect(names.toSorted((left, right) => left.localeCompare(right))).toEqual(['Alpha', 'Beta'])
  })

  it('keeps the creation time across edits and stamps the update', async () => {
    const store = new SequenceStore(dataFolder, workspaceRoot)
    const first = await store.save(sequence())
    const second = await store.save({ ...first, name: 'Evening review' })
    expect(second.createdAt).toBe(first.createdAt)
    expect(Date.parse(second.updatedAt) >= Date.parse(first.updatedAt)).toBe(true)
  })

  it('writes nothing when the save changes nothing', async () => {
    const store = new SequenceStore(dataFolder, workspaceRoot)
    const first = await store.save(sequence())
    const second = await store.save(first)
    expect(second).toEqual(first)
  })

  it('refuses blanks in words, and only blanks', () => {
    expect(() => validateSequenceInput(sequence({ name: '  ' }))).toThrow(
      UI_TEXT.promptTitleRequired,
    )
    expect(() => validateSequenceInput(sequence({ steps: [] }))).toThrow(UI_TEXT.sequenceNeedsStep)
    expect(() => validateSequenceInput(sequence({ steps: ['First', '  '] }))).toThrow(
      UI_TEXT.sequenceStepRequired,
    )
    expect(validateSequenceInput(sequence()).name).toBe('Morning review')
  })

  it('refuses a damaged scope in fixed words', async () => {
    const store = new SequenceStore(dataFolder, workspaceRoot)
    await store.save(sequence())
    const folder = path.join(dataFolder, PROMPT_USER_FOLDER, SEQUENCE_SUBFOLDER)
    await writeFile(path.join(folder, 'bogus.sequence.json'), 'not json')
    await expect(store.library()).rejects.toThrow(UI_TEXT.promptStoreDamaged)
  })

  it('refuses a linked sequence file instead of following it', async () => {
    const store = new SequenceStore(dataFolder, workspaceRoot)
    await store.save(sequence())
    const folder = path.join(dataFolder, PROMPT_USER_FOLDER, SEQUENCE_SUBFOLDER)
    const [file] = await libraryFiles(dataFolder)
    const target = path.join(folder, file!)
    const outside = path.join(dataFolder, 'outside.json')
    await writeFile(outside, '{}')
    await rm(target)
    // A linked sequence file is refused, never followed. Where this
    // account cannot create symlinks (Windows without the privilege), a
    // junction reports the same flags the scan refuses (not a file, a
    // symbolic link).
    if (process.platform === 'win32') {
      const outsideDir = path.join(dataFolder, 'outside-dir')
      await mkdir(outsideDir)
      await symlink(outsideDir, target, 'junction')
    } else {
      await symlink(outside, target)
    }
    await expect(store.library()).rejects.toThrow(UI_TEXT.promptStoreDamaged)
  })

  it('says busy while another writer holds the lock', async () => {
    const store = new SequenceStore(dataFolder, workspaceRoot)
    await store.save(sequence())
    const folder = path.join(dataFolder, PROMPT_USER_FOLDER, SEQUENCE_SUBFOLDER)
    await writeFile(path.join(folder, '.write-lock'), 'held')
    await expect(store.save(sequence({ name: 'Contended' }))).rejects.toThrow(
      UI_TEXT.promptStoreBusy,
    )
  })

  it('removes a sequence, and resolves when it is already gone', async () => {
    const store = new SequenceStore(dataFolder, workspaceRoot)
    await store.save(sequence())
    await store.remove('user', 'seq-1')
    expect(await store.library()).toEqual([])
    await store.remove('user', 'seq-1')
  })

  it('refuses the workspace scope without a folder', async () => {
    const store = new SequenceStore(dataFolder)
    expect(store.hasWorkspace).toBe(false)
    await expect(store.save(sequence({ scope: 'workspace' }))).rejects.toThrow(
      UI_TEXT.promptWorkspaceRequired,
    )
    await expect(store.remove('workspace', 'seq-1')).rejects.toThrow(
      UI_TEXT.promptWorkspaceRequired,
    )
    expect(await store.library()).toEqual([])
    expect(new SequenceStore(dataFolder, workspaceRoot).hasWorkspace).toBe(true)
  })
})

async function libraryFiles(dataFolder: string): Promise<string[]> {
  const entries = await readdir(path.join(dataFolder, PROMPT_USER_FOLDER, SEQUENCE_SUBFOLDER))
  return entries.filter((name) => name.endsWith('.sequence.json'))
}
